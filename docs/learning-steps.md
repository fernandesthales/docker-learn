# Learn it in small checkpoints

1. **Frontend + API:** run compose.local.yaml, open localhost:3010, and trace a create request in browser Network tools.
2. **Real time:** open two windows; observe the event-stream request and task refetches. Disconnect/reconnect a window to see resynchronization.
3. **Persistence:** replace the local API/database containers without deleting the volume. Verify records survive.
4. **Tests:** run API checks against the disposable database, then browser checks. Break an expected result, watch CI fail, and restore it.
5. **One artifact:** inspect the multistage Dockerfile. The final image serves both frontend assets and backend; env configuration is runtime-only.
6. **Deploy Dev:** complete the Hostinger runbook and enable deployments. Merge a visible UI change; record the image digest and Git revision.
7. **Promote:** manually send Dev to Stage. Change Dev again, then promote Stage to Prod: Prod must receive the older Stage digest. Create a different task in each environment to prove database separation.
8. **Failure exercise:** in Dev only, use a controlled bad release to observe readiness failure and restoration of the previous app. Do not practice destructive database migrations in production.
9. **Backup drill:** back up a database and restore into an isolated disposable instance. A volume alone is not a recovery strategy.

All three hosted environments use authentication. Local development explicitly disables it; tests separately verify login and authorization.
