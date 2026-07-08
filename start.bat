@echo off
echo Starting Fill or Bust...
start "" "http://localhost:3006"
npx serve -p 3006 -s .
pause
