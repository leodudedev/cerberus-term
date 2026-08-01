# Cerberus notification hook, PowerShell half. POSIX twin: notify.sh -- the two
# contracts have to stay identical, that file is the reference.
#
# Registered as `Invoke-Expression (Get-Content -Raw <this file>)`, so it runs
# inside the PowerShell the agent already started: no second process to pay for,
# and no ExecutionPolicy in the way (that governs loading script FILES, and
# Restricted is the default on client Windows).
#
# Written for Windows PowerShell 5.1: no ??, no ternary, no -AsHashtable.
# Keep this file ASCII-only -- Get-Content -Raw on 5.1 assumes the ANSI codepage
# for a file without a BOM, so a non-ASCII byte here would be misread.

# Gate. Outside a Cerberus pane this costs one env lookup and stops, which
# matters because the hook runs in EVERY session of this CLI on the machine, not
# just ours. It's also what lets us coexist with a tmux-gated hook, which gates
# on $TMUX_PANE, without both notifying.
if (-not $env:CERBERUS_PANE_ID) { exit 0 }

try {
  # The agent's payload travels verbatim: re-serialising it is a way to corrupt
  # it. Only our own two fields are escaped.
  # IsInputRedirected first: reading a console handle that nobody redirected
  # would block forever, and the thing blocked would be the agent's tool call.
  $payload = ''
  if ([Console]::IsInputRedirected) { $payload = [Console]::In.ReadToEnd() }
  if (-not $payload) { $payload = 'null' }

  $pane = $env:CERBERUS_PANE_ID.Replace('\', '\\').Replace('"', '\"')
  $cfg = ''
  if ($env:CLAUDE_CONFIG_DIR) {
    $cfg = $env:CLAUDE_CONFIG_DIR.Replace('\', '\\').Replace('"', '\"')
  }
  $body = '{"cerberus_pane":"' + $pane + '","config_dir":"' + $cfg + '","hook":' + $payload + '}'

  $port = $env:CERBERUS_PORT
  if (-not $port) { $port = '8898' }

  # HttpClient rather than Invoke-RestMethod: cheaper on first use, and it hands
  # back a task we can bound. Deliberately NOT fire-and-forget -- a task
  # abandoned before the request leaves the process sends nothing at all
  # (measured: zero requests arrive), so the wait is what makes this work, and
  # the cap is what keeps a stalled daemon from holding up the session.
  Add-Type -AssemblyName System.Net.Http
  $client = New-Object System.Net.Http.HttpClient
  $client.Timeout = [TimeSpan]::FromSeconds(3)
  if ($env:CERBERUS_TOKEN) {
    $client.DefaultRequestHeaders.Add('x-cerberus-token', $env:CERBERUS_TOKEN)
  }
  $content = New-Object System.Net.Http.StringContent(
    $body, [Text.Encoding]::UTF8, 'application/json')
  $task = $client.PostAsync("http://127.0.0.1:$port/event", $content)
  # $null = : nothing may reach stdout. The agent reads a hook's output.
  $null = $task.Wait(3000)
} catch {
  # Best effort, silently. A hook that fails or blocks must never break or slow
  # the agent's session, and a non-zero PreToolUse is read as "deny".
}

exit 0
