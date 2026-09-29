# Deploy Scripts

Contract deployment is network-selected and does not require source changes:

```powershell
npm run deploy:anvil
$env:POLYGON_RPC_URL = "https://..."
$env:DEPLOYER_PRIVATE_KEY = "0x..."
npm run deploy:amoy
```

Never put `DEPLOYER_PRIVATE_KEY` in frontend configuration or commit it to the
repository. Polygon Amoy deployment fails closed when either the RPC URL or
deployer key is missing. Deployment manifests must be generated from the
resulting artifacts before using them in an experiment.
