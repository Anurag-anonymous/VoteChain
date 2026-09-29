param(
  [Parameter(Mandatory = $true)]
  [string]$TransactionHash,

  [string]$RpcUrl = "http://127.0.0.1:8545"
)

$body = @{
  jsonrpc = "2.0"
  method = "eth_getTransactionReceipt"
  params = @($TransactionHash)
  id = 1
} | ConvertTo-Json -Compress

$response = Invoke-RestMethod -Uri $RpcUrl -Method Post -ContentType "application/json" -Body $body

if (-not $response.result) {
  Write-Host "Transaction not found on current Anvil chain." -ForegroundColor Yellow
  exit 1
}

$receipt = $response.result

[PSCustomObject]@{
  transactionHash = $receipt.transactionHash
  status = $receipt.status
  from = $receipt.from
  to = $receipt.to
  blockNumber = $receipt.blockNumber
  gasUsed = $receipt.gasUsed
  logCount = @($receipt.logs).Count
} | Format-List

if ($receipt.logs) {
  Write-Host "Logs:" -ForegroundColor Cyan
  $receipt.logs | Format-List address, topics, data, logIndex
}
