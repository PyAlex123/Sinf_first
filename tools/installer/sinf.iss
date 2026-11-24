; Sinf installer for Windows 10/11 x64 (stage 3, H17; ADR-018). Inno Setup 6.
;
; Puts the Windows package (tools/package-windows.ps1 → out\Sinf) into Program Files, so one
; flash drive sets up a whole computer room:
;
;   Sinf-setup.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /ROLE=student /PC=ПК-05 /AUTOSTART=1
;   Sinf-setup.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /ROLE=teacher
;
; - /ROLE and /PC are written to {app}\setup.json; Sinf reads it at the first start of each Windows
;   user and skips the role window (apps/desktop-core/SetupFile.cs). Without them the wizard asks
;   and a silent install leaves the question to Sinf — unless Sinf was installed here before: then
;   the role and the name of that install are kept (an update, B6).
; - A student computer starts Sinf with Windows for every user (HKLM Run) only when asked: the
;   wizard's checkbox or /AUTOSTART=1, off by default. The author's laptop, set up as a student's
;   computer to try the kiosk, opened the kiosk at every start of Windows and had to be rescued in
;   Safe Mode (test finding 5). An update keeps the choice. With the agent Sinf is the student
;   account's shell anyway.
; - WebView2 Runtime is installed from the bundled offline installer when it is missing (CLAUDE.md
;   §3.2): school internet is not to be relied on.
; - The firewall lets Sinf in (and on the teacher's computer its lesson server), so Windows asks no
;   questions about networks in front of the class.
; - Uninstalling removes the program, the autostart and the firewall rules. Lessons, results and the
;   children's files in each user's %LOCALAPPDATA%\Sinf stay: they are the school's, not the program's.
;
; - The agent (stage 6, B7; ADR-024) only when asked, and only on a student computer: the wizard's
;   checkbox or /AGENT=1. It makes the "Ученик" account with autologon and Sinf as its shell
;   (Sinf.Agent.exe enable); /AGENT=0, a teacher's role or removing Sinf undo it (disable).
;   Uninstall with /REMOVEACCOUNT=1 also deletes the account the agent made.
; - Updates (stage 6, B6; ADR-023): the task "Sinf\Update" runs {app}\Sinf.Updater.exe as SYSTEM
;   every 30 minutes and 5 minutes after Windows starts. An update is this same installer built with
;   /DUpdateBuild (no WebView2 inside, Sinf-update-<version>.exe) and run with /UPDATE=1: silent,
;   and the computer keeps its role and name from the previous install.
;
; Build (from the repository root, after tools/package-windows.ps1):
;   iscc /DAppVersion=0.3.0 tools\installer\sinf.iss
;   iscc /DAppVersion=0.3.0 /DUpdateBuild tools\installer\sinf.iss
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
#ifdef UpdateBuild
  ; An update goes to computers that already have WebView2: tens of MB, not two hundred.
  #define WebView2Installer AddBackslash(SourcePath) + "redist\no-webview2-in-updates.exe"
  #define OutputName "Sinf-update-" + AppVersion
#else
  #define WebView2Installer AddBackslash(SourcePath) + "redist\MicrosoftEdgeWebView2RuntimeInstallerX64.exe"
  #define OutputName "Sinf-setup-" + AppVersion
#endif
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
OutputBaseFilename={#OutputName}
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
ru.RoleStudent=Компьютер ученика — экран ученика на весь экран (киоск)
ru.RoleNeeded=Выберите роль компьютера.
ru.PcTitle=Имя компьютера
ru.PcSubtitle=Так компьютер будет называться в рассадке и на плитках учителя.
ru.PcPrompt=Например, ПК-05. Не больше 20 знаков.
ru.PcLabel=Имя:
ru.PcNeeded=Введите имя компьютера, не больше 20 знаков.
ru.WebView2=Устанавливается среда WebView2…
ru.Firewall=Настраивается брандмауэр Windows…
ru.LaunchSinf=Открыть Sinf
ru.AgentTitle=Запуск и закрытая среда
ru.AgentSubtitle=Как Sinf открывается на компьютере ученика.
ru.AgentPrompt=Без галочек Sinf открывают из меню «Пуск» или с рабочего стола. «Запускать при входе в Windows» — для компьютеров класса. Агент создаёт учётку «Ученик» с автовходом, ставит Sinf вместо рабочего стола, отключает диспетчер задач и смену пользователя и поднимает Sinf, если его закрыть; отключается командой «Sinf.Agent.exe disable» или удалением Sinf. Первый раз включайте агент на запасном компьютере, не на своём.
ru.AutostartCheck=Запускать Sinf при входе в Windows
ru.AgentCheck=Включить закрытую среду (агент)
ru.AgentOn=Включается закрытая среда…

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
#ifexist WebView2Installer
Source: "{#WebView2Installer}"; DestDir: "{tmp}"; Flags: deleteafterinstall; Check: NeedsWebView2
#else
  #pragma message "WebView2 offline installer not found: built without it"
#endif

[Icons]
Name: "{autoprograms}\Sinf"; Filename: "{app}\Sinf.exe"
; Whoever opens Sinf by hand gets a desktop icon: the teacher, and a student computer without autostart.
Name: "{autodesktop}\Sinf"; Filename: "{app}\Sinf.exe"; Check: OpensByHand

[Registry]
Root: HKLM; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "Sinf"; ValueData: """{app}\Sinf.exe"""; Flags: uninsdeletevalue; Check: WantsAutostart
; Installed again without it (or as the teacher's computer): it no longer starts with Windows.
Root: HKLM; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueName: "Sinf"; Flags: deletevalue; Check: OpensByHand

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
Type: filesandordirs; Name: "{app}\updates"

[Code]
var
  RolePage: TInputOptionWizardPage;
  PcPage: TInputQueryWizardPage;
  { The student computer's start: [0] — with Windows, [1] — the agent (B7). }
  AgentPage: TInputOptionWizardPage;
  { Was the agent's service here before this install? 0 — not asked yet, 1 — yes, 2 — no. }
  AgentBefore: Integer;

{ What the last install wrote into setup.json in the program folder: the computer's own memory of
  its role and name, which an update (B6) must keep. Empty before the folder is known, or when
  there is none. }
function InstalledSetupValue(const Key: String): String;
var
  Lines: TArrayOfString;
  Line, Marker: String;
  P: Integer;
begin
  Result := '';
  try
    if not LoadStringsFromFile(ExpandConstant('{app}\setup.json'), Lines) then
      Exit;
  except
    Exit;
  end;
  if GetArrayLength(Lines) = 0 then
    Exit;
  Line := Lines[0];
  Marker := '"' + Key + '":"';
  P := Pos(Marker, Line);
  if P = 0 then
    Exit;
  Line := Copy(Line, P + Length(Marker), Length(Line));
  P := Pos('"', Line);
  if P > 0 then
    Result := Copy(Line, 1, P - 1);
end;

{ "teacher", "student" or "" — from /ROLE=, as typed; else what this computer was before (an
  update, B6, runs with no /ROLE at all and must not forget it). }
function RoleParam: String;
begin
  Result := Lowercase(Trim(ExpandConstant('{param:ROLE|}')));
  if (Result <> 'teacher') and (Result <> 'student') then
    Result := Lowercase(GetPreviousData('Role', ''));
  if (Result <> 'teacher') and (Result <> 'student') then
    Result := InstalledSetupValue('role');
  if (Result <> 'teacher') and (Result <> 'student') then
    Result := '';
end;

function PcParam: String;
begin
  Result := Trim(ExpandConstant('{param:PC|}'));
  if Result = '' then
    Result := GetPreviousData('Pc', '');
  if Result = '' then
    Result := InstalledSetupValue('pc');
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

function AgentInstalled: Boolean;
var
  Code: Integer;
begin
  Result := Exec(ExpandConstant('{sys}\sc.exe'), 'query SinfAgent', '', SW_HIDE, ewWaitUntilTerminated, Code) and (Code = 0);
end;

{ The agent (B7): /AGENT=1 or 0 when given; else the wizard's checkbox; else what it was before —
  an update must never switch the closed environment off by itself. }
function AgentParam: String;
begin
  Result := Trim(ExpandConstant('{param:AGENT|}'));
  if (Result = '1') or (Result = '0') then
    Exit;
  if AgentBefore = 0 then
  begin
    if AgentInstalled then
      AgentBefore := 1
    else
      AgentBefore := 2;
  end;
  if AgentBefore = 1 then
    Result := '1'
  else
    Result := GetPreviousData('Agent', '0');
end;

function WantsAgent: Boolean;
begin
  if not IsStudent then
    Result := False
  else if WizardSilent or (AgentPage = nil) then
    Result := AgentParam = '1'
  else
    Result := AgentPage.Values[1];
end;

{ With Windows (finding 5): /AUTOSTART=1 or 0 when given; else what this computer had before (an
  update keeps it; an install from before the choice existed had it on); else off. }
function AutostartParam: String;
var
  Command: String;
begin
  Result := Trim(ExpandConstant('{param:AUTOSTART|}'));
  if (Result = '1') or (Result = '0') then
    Exit;
  Result := GetPreviousData('Autostart', '');
  if (Result = '1') or (Result = '0') then
    Exit;
  Result := InstalledSetupValue('autostart');
  if (Result = '1') or (Result = '0') then
    Exit;
  if RegQueryStringValue(HKLM, 'Software\Microsoft\Windows\CurrentVersion\Run', 'Sinf', Command)
    and (Command <> '') then
    Result := '1'
  else
    Result := '0';
end;

function WantsAutostart: Boolean;
begin
  if not IsStudent then
    Result := False
  else if WizardSilent or (AgentPage = nil) then
    Result := AutostartParam = '1'
  else
    Result := AgentPage.Values[0];
end;

function OpensByHand: Boolean;
begin
  Result := not WantsAutostart;
end;

procedure RunAgent(const Command: String);
var
  Code: Integer;
begin
  if not FileExists(ExpandConstant('{app}\Sinf.Agent.exe')) then
    Exit;
  Exec(ExpandConstant('{app}\Sinf.Agent.exe'), Command, '', SW_HIDE, ewWaitUntilTerminated, Code);
  Log('Sinf.Agent.exe ' + Command + ': ' + IntToStr(Code));
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

procedure RegisterPreviousData(PreviousDataKey: Integer);
begin
  SetPreviousData(PreviousDataKey, 'Role', ChosenRole);
  SetPreviousData(PreviousDataKey, 'Pc', ChosenPc);
  if WantsAgent then
    SetPreviousData(PreviousDataKey, 'Agent', '1')
  else
    SetPreviousData(PreviousDataKey, 'Agent', '0');
  if WantsAutostart then
    SetPreviousData(PreviousDataKey, 'Autostart', '1')
  else
    SetPreviousData(PreviousDataKey, 'Autostart', '0');
end;

{ The updater's tasks (B6): as SYSTEM, every 30 minutes and 5 minutes after Windows starts. Made
  afresh on every install, so a reinstall into another folder points them at the new one. }
procedure CreateUpdateTasks;
var
  Run: String;
  Code: Integer;
begin
  Run := '\"' + ExpandConstant('{app}\Sinf.Updater.exe') + '\"';
  Exec(ExpandConstant('{sys}\schtasks.exe'),
    '/Create /F /TN "Sinf\Update" /SC MINUTE /MO 30 /RU SYSTEM /RL HIGHEST /TR "' + Run + '"',
    '', SW_HIDE, ewWaitUntilTerminated, Code);
  Log('schtasks Sinf\Update: ' + IntToStr(Code));
  Exec(ExpandConstant('{sys}\schtasks.exe'),
    '/Create /F /TN "Sinf\Update at start" /SC ONSTART /DELAY 0005:00 /RU SYSTEM /RL HIGHEST /TR "' + Run + '"',
    '', SW_HIDE, ewWaitUntilTerminated, Code);
  Log('schtasks Sinf\Update at start: ' + IntToStr(Code));
end;

procedure DeleteUpdateTasks;
var
  Code: Integer;
begin
  Exec(ExpandConstant('{sys}\schtasks.exe'), '/Delete /F /TN "Sinf\Update"', '', SW_HIDE, ewWaitUntilTerminated, Code);
  Exec(ExpandConstant('{sys}\schtasks.exe'), '/Delete /F /TN "Sinf\Update at start"', '', SW_HIDE, ewWaitUntilTerminated, Code);
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

  AgentPage := CreateInputOptionPage(PcPage.ID, CustomMessage('AgentTitle'),
    CustomMessage('AgentSubtitle'), CustomMessage('AgentPrompt'), False, False);
  AgentPage.Add(CustomMessage('AutostartCheck'));
  AgentPage.Add(CustomMessage('AgentCheck'));
  AgentPage.Values[0] := AutostartParam = '1';
  AgentPage.Values[1] := AgentParam = '1';
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := ((PcPage <> nil) and (PageID = PcPage.ID) and (RolePage.SelectedValueIndex <> 1))
    or ((AgentPage <> nil) and (PageID = AgentPage.ID) and (RolePage.SelectedValueIndex <> 1));
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
var
  Code: Integer;
begin
  { The agent's service holds its file and would bring Sinf back mid-install: it stops first. }
  if AgentInstalled then
  begin
    Exec(ExpandConstant('{sys}\sc.exe'), 'stop SinfAgent', '', SW_HIDE, ewWaitUntilTerminated, Code);
    Sleep(1500);
  end;
  CloseSinf;
  Result := '';
end;

function InitializeUninstall: Boolean;
begin
  { Ordinary Windows again before the files go: shell, policies, autologon, the service. }
  if Trim(ExpandConstant('{param:REMOVEACCOUNT|0}')) = '1' then
    RunAgent('disable --remove-account')
  else
    RunAgent('disable');
  CloseSinf;
  DeleteUpdateTasks;
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
  CreateUpdateTasks;
  { The agent (B7): on when wanted — again after an update, which keeps the choice; off when not. }
  if WantsAgent then
  begin
    WizardForm.StatusLabel.Caption := CustomMessage('AgentOn');
    RunAgent('enable');
  end
  else if AgentInstalled then
    RunAgent('disable');
  Role := ChosenRole;
  if Role = '' then
  begin
    { Nobody said: Sinf asks at its first start, as from the archive. }
    DeleteFile(ExpandConstant('{app}\setup.json'));
    Exit;
  end;
  SetArrayLength(Lines, 1);
  if (Role = 'student') and WantsAutostart then
    Lines[0] := '{"role":"student","pc":"' + JsonText(ChosenPc) + '","autostart":"1"}'
  else if Role = 'student' then
    Lines[0] := '{"role":"student","pc":"' + JsonText(ChosenPc) + '","autostart":"0"}'
  else
    Lines[0] := '{"role":"teacher"}';
  SaveStringsToUTF8File(ExpandConstant('{app}\setup.json'), Lines, False);
end;
