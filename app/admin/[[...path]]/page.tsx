import { redirect } from "next/navigation";

export const metadata = { robots: { index: false, follow: false } };

export default async function AdminAlias({
  params,
}: PageProps<"/admin/[[...path]]">): Promise<never> {
  const { path = [] } = await params;
  redirect(
    `/trafalgar${path.length ? `/${path.map(encodeURIComponent).join("/")}` : ""}`,
  );
}
