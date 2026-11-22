@echo off
rem Roda como administrador (chamado pelo iniciar.bat). Libera o celular no Firewall do Windows.
netsh advfirewall firewall delete rule name="SKZ VR 8080" >nul 2>nul
netsh advfirewall firewall delete rule name="SKZ VR navegador UDP" >nul 2>nul
netsh advfirewall firewall delete rule name="SKZ VR node" >nul 2>nul
netsh advfirewall firewall add rule name="SKZ VR 8080" dir=in action=allow protocol=TCP localport=8080 profile=any
for %%P in ("%ProgramFiles%\Google\Chrome\Application\chrome.exe" "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" "%LocalAppData%\Google\Chrome\Application\chrome.exe" "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" "%ProgramFiles%\nodejs\node.exe") do (
  if exist %%P netsh advfirewall firewall add rule name="SKZ VR navegador UDP" dir=in action=allow protocol=ANY profile=any program=%%P
)
