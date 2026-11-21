; Sinf installer for Windows 10/11 x64 (stage 3, H17; ADR-018). Inno Setup 6.
;
; Puts the Windows package (tools/package-windows.ps1 → out\Sinf) into Program Files, so one
; flash drive sets up a whole computer room:
;
;   Sinf-setup.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /ROLE=student /PC=ПК-05
;   Sinf-setup.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /ROLE=teacher
;
; - /ROLE and /PC are written to {app}\setup.json; Sinf reads it at the first start of each Windows
;   user and skips the role window (apps/desktop-core/SetupFile.cs). Without them the wizard asks;
;   a silent install without them leaves the question to Sinf.
; - A student computer starts Sinf with Windows for every user (HKLM Run): the "Ученик" account
;   the kiosk runs under is not the administrator who installs.
; - WebView2 Runtime is installed from the bundled offline installer when it is missing (CLAUDE.md
;   §3.2): school internet is not to be relied on.
; - The firewall lets Sinf in (and on the teacher's computer its lesson server), so Windows asks no
;   questions about networks in front of the class.
; - Uninstalling removes the program, the autostart and the firewall rules. Lessons, results and the
;   children's files in each user's %LOCALAPPDATA%\Sinf stay: they are the school's, not the program's.
;
; Build (from the repository root, after tools/package-windows.ps1):
;   iscc /DAppVersion=0.3.0 tools\installer\sinf.iss
; The WebView2 offline installer is taken from tools\installer\redist\ when it is there
; (MicrosoftEdgeWebView2RuntimeInstallerX64.exe, downloaded by CI); without it the installer is built
; without one and says so.

#ifndef AppVersion
  #define AppVersion "0.3.0"
#endif
#ifndef SourceDir
  #define SourceDir "..\..\out\Sinf"
#endif
#ifndef OutputDir
  #define OutputDir "..\..\out\installer"
#endif
#define WebView2Installer AddBackslash(SourcePath) + "redist\MicrosoftEdgeWebView2RuntimeInstallerX64.exe"
#define WebView2Client "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"

[Setup]
AppId={{5E7C3B1A-9D2F-4C8E-A6B4-3F1D2E9C7A50}
AppName=Sinf
AppVersion={#AppVersion}
AppVerName=Sinf {#AppVersion}
AppPublisher=Sinf
DefaultDirName={autopf}\Sinf
DisableProgramGroupPage=yes
DisableDirPage=auto
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir={#OutputDir}
OutputBaseFilename=Sinf-setup-{#AppVersion}
SetupIconFile={#SourceDir}\sinf.ico
UninstallDisplayIcon={app}\Sinf.exe
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
; A running Sinf is closed by the code below: Windows Restart Manager would only ask.
CloseApplications=no
RestartApplications=no

[Languages]
Name: "ru"; MessagesFile: "compiler:Languages\Russian.isl"

[CustomMessages]
ru.RoleTitle=Что это за компьютер?
ru.RoleSubtitle=Один и тот же Sinf ставится на компьютер учителя и на компьютеры учеников.
ru.RolePrompt=Выберите роль этого компьютера в кабинете:
ru.RoleTeacher=Компьютер учителя — пульт урока и сервер класса
ru.RoleStudent=Компьютер ученика — закрытая среда (киоск), запускается вместе с Windows
ru.RoleNeeded=Выберите роль компьютера.
ru.PcTitle=Имя компьютера
ru.PcSubtitle=Так компьютер будет называться в рассадке и на плитках учителя.
ru.PcPrompt=Например, ПК-05. Не больше 20 знаков.
ru.PcLabel=Имя:
ru.PcNeeded=Введите имя компьютера, не больше 20 знаков.
ru.WebView2=Устанавливается среда WebView2…
ru.Firewall=Настраивается брандмауэр Windows…
ru.LaunchSinf=Открыть Sinf

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
#ifexist WebView2Installer
Source: "{#WebView2Installer}"; DestDir: "{tmp}"; Flags: deleteafterinstall; Check: NeedsWebView2
#else
  #pragma message "WebView2 offline installer not found: built without it"
#endif

[Icons]
Name: "{autoprograms}\Sinf"; Filename: "{app}\Sinf.exe"
; Only the teacher opens Sinf by hand; a student computer opens it with Windows.
Name: "{autodesktop}\Sinf"; Filename: "{app}\Sinf.exe"; Check: IsTeacher

[Registry]
Root: HKLM; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "Sinf"; ValueData: """{app}\Sinf.exe"""; Flags: uninsdeletevalue; Check: IsStudent
; Installed again as a teacher's computer: it no longer starts with Windows.
Root: HKLM; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueName: "Sinf"; Flags: deletevalue; Check: IsTeacher

[Run]
#ifexist WebView2Installer
Filename: "{tmp}\MicrosoftEdgeWebView2RuntimeInstallerX64.exe"; Parameters: "/silent /install"; StatusMsg: "{cm:WebView2}"; Flags: waituntilterminated; Check: NeedsWebView2
#endif
; The rules are made afresh on every install: a reinstall into another folder must not keep the old.
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""Sinf"""; Flags: runhidden waituntilterminated
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""Sinf server"""; Flags: runhidden waituntilterminated
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall add rule name=""Sinf"" dir=in action=allow program=""{app}\Sinf.exe"" enable=yes profile=any"; StatusMsg: "{cm:Firewall}"; Flags: runhidden waituntilterminated
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall add rule name=""Sinf server"" dir=in action=allow program=""{app}\server\node.exe"" enable=yes profile=any"; Flags: runhidden waituntilterminated; Check: IsTeacher
Filename: "{app}\Sinf.exe"; Description: "{cm:LaunchSinf}"; Flags: postinstall nowait skipifsilent runasoriginaluser; Check: IsTeacher

[UninstallRun]
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""Sinf"""; Flags: runhidden waituntilterminated; RunOnceId: "FirewallSinf"
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""Sinf server"""; Flags: runhidden waituntilterminated; RunOnceId: "FirewallServer"

[UninstallDelete]
Type: files; Name: "{app}\setup.json"

[Code]
var
  RolePage: TInputOptionWizardPage;
  PcPage: TInputQueryWizardPage;

{ "teacher", "student" or "" — from /ROLE=, as typed. }
function RoleParam: String;
begin
  Result := Lowercase(Trim(ExpandConstant('{param:ROLE|}')));
  if (Result <> 'teacher') and (Result <> 'student') then
    Result := '';
end;

function PcParam: String;
begin
  Result := Trim(ExpandConstant('{param:PC|}'));
end;

{ The role chosen: the wizard's page, or /ROLE in a silent install. }
function ChosenRole: String;
begin
  Result := '';
  if WizardSilent or (RolePage = nil) then
    Result := RoleParam
  else if RolePage.SelectedValueIndex = 0 then
    Result := 'teacher'
  else if RolePage.SelectedValueIndex = 1 then
    Result := 'student';
end;

function ChosenPc: String;
begin
  if WizardSilent or (PcPage = nil) then
    Result := PcParam
  else
    Result := Trim(PcPage.Values[0]);
end;

function IsTeacher: Boolean;
begin
  Result := ChosenRole = 'teacher';
end;

function IsStudent: Boolean;
begin
  Result := ChosenRole = 'student';
end;

{ Found in either place Microsoft puts it: for the whole computer or for one user. }
function NeedsWebView2: Boolean;
var
  Version: String;
begin
  Result := True;
  if RegQueryStringValue(HKLM, 'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{#WebView2Client}', 'pv', Version)
    and (Version <> '') and (Version <> '0.0.0.0') then
    Result := False
  else if RegQueryStringValue(HKCU, 'Software\Microsoft\EdgeUpdate\Clients\{#WebView2Client}', 'pv', Version)
    and (Version <> '') and (Version <> '0.0.0.0') then
    Result := False;
end;

procedure InitializeWizard;
begin
  RolePage := CreateInputOptionPage(wpSelectDir, CustomMessage('RoleTitle'),
    CustomMessage('RoleSubtitle'), CustomMessage('RolePrompt'), True, False);
  RolePage.Add(CustomMessage('RoleTeacher'));
  RolePage.Add(CustomMessage('RoleStudent'));
  if RoleParam = 'teacher' then
    RolePage.SelectedValueIndex := 0
  else if RoleParam = 'student' then
    RolePage.SelectedValueIndex := 1;

  PcPage := CreateInputQueryPage(RolePage.ID, CustomMessage('PcTitle'),
    CustomMessage('PcSubtitle'), CustomMessage('PcPrompt'));
  PcPage.Add(CustomMessage('PcLabel'), False);
  PcPage.Values[0] := PcParam;
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := (PcPage <> nil) and (PageID = PcPage.ID) and (RolePage.SelectedValueIndex <> 1);
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  Pc: String;
begin
  Result := True;
  if (RolePage <> nil) and (CurPageID = RolePage.ID) and (RolePage.SelectedValueIndex < 0) then
  begin
    MsgBox(CustomMessage('RoleNeeded'), mbError, MB_OK);
    Result := False;
  end;
  if (PcPage <> nil) and (CurPageID = PcPage.ID) then
  begin
    Pc := Trim(PcPage.Values[0]);
    if (Pc = '') or (Length(Pc) > 20) then
    begin
      MsgBox(CustomMessage('PcNeeded'), mbError, MB_OK);
      Result := False;
    end;
  end;
end;

{ A running Sinf (the kiosk, or the teacher's panel) is closed before its files are replaced; its
  lesson server goes with it (it lives in Sinf's job object). }
procedure CloseSinf;
var
  Code: Integer;
begin
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/F /IM Sinf.exe', '', SW_HIDE, ewWaitUntilTerminated, Code);
  Sleep(500);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  CloseSinf;
  Result := '';
end;

function InitializeUninstall: Boolean;
begin
  CloseSinf;
  Result := True;
end;

{ JSON string content: the name comes from a person, so quotes and backslashes are escaped. }
function JsonText(const Value: String): String;
var
  I: Integer;
  C: String;
begin
  Result := '';
  for I := 1 to Length(Value) do
  begin
    C := Copy(Value, I, 1);
    if (C = '"') or (C = '\') then
      Result := Result + '\' + C
    else if Ord(C[1]) < 32 then
      Result := Result + ' '
    else
      Result := Result + C;
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  Lines: TArrayOfString;
  Role: String;
begin
  if CurStep <> ssPostInstall then
    Exit;
  Role := ChosenRole;
  if Role = '' then
  begin
    { Nobody said: Sinf asks at its first start, as from the archive. }
    DeleteFile(ExpandConstant('{app}\setup.json'));
    Exit;
  end;
  SetArrayLength(Lines, 1);
  if Role = 'student' then
    Lines[0] := '{"role":"student","pc":"' + JsonText(ChosenPc) + '"}'
  else
    Lines[0] := '{"role":"teacher"}';
  SaveStringsToUTF8File(ExpandConstant('{app}\setup.json'), Lines, False);
end;
