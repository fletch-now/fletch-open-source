# Backups and recovery

Back up the database, persistent source workspaces, checkpoints and publication releases as a coordinated set. Preserve the secrets required to decrypt stored credentials in a separate access-controlled recovery system. Losing `MODEL_CREDENTIAL_KEY` makes encrypted hosted model keys unusable; restoring the database without project files can leave builds unrecoverable.

The repository includes `scripts/fletch-backup.sh`, `pull-fletch-backups.py`, source-backup timers and reaping tools. Review destination paths, retention, role permissions and encryption for your installation. Backups, logs and recovery manifests never belong in Git or a public artifact bucket.

Before trusting a backup, restore it into an isolated environment with fresh public URLs, disabled workers and no active deployer/payment keys. Verify database invariants and saved source, then test preview reconstruction. Ensure restored jobs cannot rebroadcast transactions or publish old versions: use the durable execution/effect records and reconciliation flow.

Rotate/revoke an exposed provider key or signer independently of deleting its file. Re-encrypt hosted credential records through a deliberate migration if changing the encryption key; replacing the environment variable alone does not rotate existing ciphertext. Coordinate authentication-secret rotation with session invalidation. Keep restoration results private when they contain customer or operational data.
