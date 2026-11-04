#define MyAppName "CartridgeControl"
#define MyAppPublisher "ThodProd"
#define MyAppExeName "CartridgeControl.exe"
#ifndef MyAppVersion
  #define MyAppVersion "1.1.18"
#endif

[Setup]
AppId={{B85E99ED-9079-49EC-875A-3866F8F2F8E7}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={localappdata}\Programs\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=..\release
OutputBaseFilename=CartridgeControl-{#MyAppVersion}-Setup
SetupIconFile=..\build\icon.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=force
RestartApplications=no
ChangesAssociations=no
VersionInfoVersion={#MyAppVersion}
VersionInfoCompany={#MyAppPublisher}
VersionInfoDescription=Установщик {#MyAppName}
VersionInfoProductName={#MyAppName}
VersionInfoProductVersion={#MyAppVersion}

[Languages]
Name: "russian"; MessagesFile: "compiler:Languages\Russian.isl"

[Tasks]
Name: "desktopicon"; Description: "Создать ярлык на рабочем столе"; GroupDescription: "Дополнительные значки:"; Flags: unchecked

[Files]
Source: "..\release\windows-native-{#MyAppVersion}\*"; DestDir: "{app}"; Excludes: "Data\*"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "redist\MicrosoftEdgeWebview2Setup.exe"; DestDir: "{tmp}"; Flags: deleteafterinstall; Check: not IsWebView2Installed

[Dirs]
Name: "{app}\Data"

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{tmp}\MicrosoftEdgeWebview2Setup.exe"; Parameters: "/silent /install"; StatusMsg: "Установка компонента Microsoft Edge WebView2..."; Flags: waituntilterminated; Check: not IsWebView2Installed
Filename: "{app}\{#MyAppExeName}"; Description: "Запустить {#MyAppName}"; WorkingDir: "{app}"; Flags: nowait postinstall skipifsilent

[Code]
const
  WebView2ClientKey = 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';

function HasWebView2Version(RootKey: Integer; const SubKey: String): Boolean;
var
  Version: String;
begin
  Result := RegQueryStringValue(RootKey, SubKey, 'pv', Version) and
    (Version <> '') and (Version <> '0.0.0.0');
end;

function IsWebView2Installed: Boolean;
begin
  Result := HasWebView2Version(HKCU, WebView2ClientKey) or
    HasWebView2Version(HKLM32, WebView2ClientKey) or
    HasWebView2Version(HKLM64, WebView2ClientKey);
end;
