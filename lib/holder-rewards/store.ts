import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { activationProblem, EMPTY_HOLDER_POLICY, HOLDER_CAMPAIGN, HOLDER_CHECK_MS, HOLDER_CREDITS, HOLDER_POLICY_KEY, HOLDER_PRICE_MAX_AGE_MS,
  HolderPolicySchema, holderStatus, holdingValue, rewardPeriod, type HolderEvidence, type HolderPolicy, type HolderStatus } from "./model";
import { HolderReadingError, observeHolding } from "./observe";

type Database = typeof db;
type Executor = Pick<Database, "execute">;
function accountKey(userId: string): string { return createHash("sha256").update(userId).digest("hex"); }

export async function readHolderPolicy(database: Executor = db): Promise<HolderPolicy> {
  const result = await database.execute<{ value: string }>(sql`select value from app_settings where key=${HOLDER_POLICY_KEY}`);
  if (!result.rows[0]) return { ...EMPTY_HOLDER_POLICY };
  return HolderPolicySchema.parse(JSON.parse(result.rows[0].value));
}

async function verifiedWallet(userId: string, policy: HolderPolicy, database: Executor): Promise<string | null> {
  const result = await database.execute<{ address: string }>(sql`
    select lower(w.address) as address from wallet_address w join "user" u on u.id=w.user_id
    where w.user_id=${userId} and w.chain_id=${policy.chainId} and coalesce(u.banned,false)=false
      and w.address ~* '^0x[0-9a-f]{40}$'
    order by w.is_primary desc nulls last,w.created_at,w.id limit 1
  `);
  return result.rows[0]?.address ?? null;
}

interface Admission { policy: HolderPolicy; wallet: string; period: string; lease: string }

export async function checkHolderReward(userId: string, database: Database = db, observe = observeHolding): Promise<HolderStatus> {
  const admitted = await database.transaction(async function admit(tx): Promise<Admission | HolderStatus> {
    const policy = await readHolderPolicy(tx);
    if (!policy.enabled || activationProblem(policy)) return holderStatus(policy, "not_open", "$FLTX holder credits are not open yet.");
    await tx.execute(sql`select id from "user" where id=${userId} for update`);
    const wallet = await verifiedWallet(userId, policy, tx);
    if (!wallet) return holderStatus(policy, "verify_wallet", "Sign in with your holding wallet on Robinhood Chain mainnet to verify eligibility.");
    const period = rewardPeriod(policy, new Date());
    const previous = await tx.execute<{ id: string; evidence: HolderEvidence }>(sql`
      select id,evidence from holder_credit_claims where campaign=${HOLDER_CAMPAIGN} and period=${period}
        and (address=${wallet} or account_key=${accountKey(userId)}) limit 1
    `);
    if (previous.rows[0]) return holderStatus(policy, "already_granted", "The 10-credit holder reward has already been awarded for this period.",
      { wallet, grantId: previous.rows[0].id, checkedAt: previous.rows[0].evidence.checkedAt, priceAt: previous.rows[0].evidence.priceAt });
    const cached = await tx.execute<{ result: HolderStatus }>(sql`
      select result from holder_credit_checks where user_id=${userId} and revision=${policy.revision}
        and period=${period} and wallet=${wallet} and next_check_at>clock_timestamp()
    `);
    if (cached.rows[0]) return cached.rows[0].result;
    const budget = await tx.execute<{ count: number }>(sql`
      insert into rate_counters(bucket,count,window_start) values('fltx:checks:minute',1,now())
      on conflict(bucket) do update set
        count=case when rate_counters.window_start<now()-interval '1 minute' then 1 else rate_counters.count+1 end,
        window_start=case when rate_counters.window_start<now()-interval '1 minute' then now() else rate_counters.window_start end
      returning count
    `);
    const checking = holderStatus(policy, "checking", "Checking the token balance and reference price.", { wallet });
    const limited = budget.rows[0].count > 120;
    const lease = randomUUID();
    const status = limited ? holderStatus(policy, "unavailable", "Holder checks are busy. Fletch will retry automatically.", { wallet }) : checking;
    await tx.execute(sql`
      insert into holder_credit_checks(user_id,revision,period,wallet,lease,next_check_at,result)
      values(${userId},${policy.revision},${period},${wallet},${lease},clock_timestamp()+interval '1 minute',${JSON.stringify(status)}::jsonb)
      on conflict(user_id) do update set revision=excluded.revision,period=excluded.period,wallet=excluded.wallet,
        lease=excluded.lease,next_check_at=excluded.next_check_at,result=excluded.result
    `);
    if (limited) return status;
    return { policy, wallet, period, lease };
  });
  if (!("lease" in admitted)) return admitted;
  const { policy, wallet, lease } = admitted;
  let evidence: HolderEvidence | null = null;
  let status: HolderStatus;
  try {
    evidence = await observe(policy, wallet);
    const valuation = holdingValue(evidence.balanceRaw, evidence.decimals, evidence.priceUsd);
    status = holderStatus(policy, "below_threshold", "This wallet needs more than $100 of $FLTX to qualify.",
      { wallet, checkedAt: evidence.checkedAt, priceAt: evidence.priceAt, valueUsd: valuation.valueUsd });
    if (valuation.qualifies) status = await grantHolderReward(userId, admitted, evidence, database);
  } catch (error) {
    status = holderStatus(policy, "unavailable", error instanceof HolderReadingError ? error.message : "The holder-credit result could not be confirmed. Fletch will retry without awarding duplicate credits.", { wallet, checkedAt: new Date().toISOString() });
  }
  // A late request cannot overwrite a newer check after the lease has expired.
  await database.execute(sql`update holder_credit_checks set result=${JSON.stringify(status)}::jsonb,lease=null,
    next_check_at=clock_timestamp()+${HOLDER_CHECK_MS}*interval '1 millisecond' where user_id=${userId} and lease=${lease}`);
  return status;
}

export async function grantHolderReward(userId: string, admission: Admission, evidence: HolderEvidence, database: Database = db): Promise<HolderStatus> {
  return database.transaction(async function grant(tx): Promise<HolderStatus> {
    // Serializes policy edits, the daily grant ceiling and grant insertion.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${HOLDER_CAMPAIGN}))`);
    const policy = await readHolderPolicy(tx);
    const period = rewardPeriod(policy, new Date());
    if (!policy.enabled || activationProblem(policy) || policy.revision !== admission.policy.revision || period !== admission.period) throw new HolderReadingError("The reward policy changed. Fletch will check the new terms.");
    await tx.execute(sql`select id from "user" where id=${userId} for update`);
    if (await verifiedWallet(userId, policy, tx) !== admission.wallet) throw new HolderReadingError("The verified wallet changed. Sign in again to check eligibility.");
    const active = await tx.execute(sql`select 1 from holder_credit_checks where user_id=${userId} and lease=${admission.lease} and next_check_at>clock_timestamp()`);
    if (!active.rows.length) throw new HolderReadingError("This check expired. Fletch will retry.");
    const now = Date.now();
    if (evidence.address !== admission.wallet || evidence.chainId !== policy.chainId || evidence.tokenAddress !== policy.tokenAddress ||
        evidence.poolId !== policy.referencePoolId || now - Date.parse(evidence.checkedAt) < 0 || now - Date.parse(evidence.checkedAt) > 30_000 ||
        !Number.isFinite(Date.parse(evidence.priceAt)) || now - Date.parse(evidence.priceAt) < 0 || now - Date.parse(evidence.priceAt) > HOLDER_PRICE_MAX_AGE_MS ||
        !Number.isFinite(Date.parse(evidence.checkedAt)) || !holdingValue(evidence.balanceRaw, evidence.decimals, evidence.priceUsd).qualifies) throw new HolderReadingError("Fresh qualifying balance and price evidence are required.");
    const existing = await tx.execute<{ id: string }>(sql`select id from holder_credit_claims where campaign=${HOLDER_CAMPAIGN} and period=${period}
      and (address=${admission.wallet} or account_key=${accountKey(userId)}) limit 1`);
    if (existing.rows[0]) return holderStatus(policy, "already_granted", "The holder reward has already been awarded.", { wallet: admission.wallet, grantId: existing.rows[0].id });
    const today = await tx.execute<{ count: number }>(sql`select count(*)::integer as count from holder_credit_claims
      where campaign=${HOLDER_CAMPAIGN} and created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'`);
    if (today.rows[0].count >= policy.maxGrantsPerDay) return holderStatus(policy, "daily_limit", "Today's holder-credit allocation is used. Fletch will check again tomorrow.", { wallet: admission.wallet });
    const id = randomUUID();
    await tx.execute(sql`insert into holder_credit_claims(id,campaign,period,address,account_key,user_id,policy,evidence,credits)
      values(${id},${HOLDER_CAMPAIGN},${period},${admission.wallet},${accountKey(userId)},${userId},${JSON.stringify(policy)}::jsonb,${JSON.stringify(evidence)}::jsonb,${HOLDER_CREDITS})`);
    await tx.execute(sql`insert into credit_events(id,user_id,delta,reason,external_ref,idempotency_key)
      values(${randomUUID()},${userId},${HOLDER_CREDITS},'holder_grant',${id},${`holder_grant:${id}`})`);
    await tx.execute(sql`insert into audit_log(id,user_id,actor_type,action,resource_type,resource_id,metadata)
      values(${`al_${randomUUID()}`},${userId},'system','credits.holder_grant','holder_reward',${id},${JSON.stringify({ campaign: HOLDER_CAMPAIGN, period, credits: HOLDER_CREDITS, policyRevision: policy.revision })}::jsonb)`);
    return holderStatus(policy, "granted", "10 $FLTX holder build credits added.", { wallet: admission.wallet, grantId: id, checkedAt: evidence.checkedAt,
      priceAt: evidence.priceAt, valueUsd: holdingValue(evidence.balanceRaw, evidence.decimals, evidence.priceUsd).valueUsd });
  });
}
