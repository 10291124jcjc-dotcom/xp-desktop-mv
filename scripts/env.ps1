# Source this before running project tools: keeps every cache/temp inside the project.
$P = $PSScriptRoot
$env:PIP_CACHE_DIR = "$P\.cache\pip"
$env:MPLCONFIGDIR  = "$P\.cache\mpl"
$env:NUMBA_CACHE_DIR = "$P\.cache\numba"
$env:U2NET_HOME    = "$P\models"
$env:TEMP = "$P\.tmp"; $env:TMP = "$P\.tmp"
$env:PLAYWRIGHT_BROWSERS_PATH = "$P\.cache\pw"
$env:PYTHONIOENCODING = "utf-8"
$env:PATH = "$P\.venv\Scripts;" + $env:PATH
