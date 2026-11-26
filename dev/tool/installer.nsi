; 北风 Windows 安装包 —— 从仓库根的发布文件构建 Setup.exe
; 构建入口是 dev/tool/pack-installer.mjs（它传 SRC_ROOT/OUT_FILE 两个宏），不要直接敲 makensis。
; 设计取向：
;   · 每用户安装（$LOCALAPPDATA\北风），不碰 Program Files、不要求管理员——和绿色版同一套哲学；
;   · 装的就是仓库根那 7 个发布文件，一字不改；数据仍存浏览器，卸载不丢书；
;   · 快捷方式指向「启动北风.bat」（本地服务模式），图标用 dev/assets/北风.ico。
; 编码：本文件必须是 UTF-8 **带 BOM**，否则中文文件名在 makensis 下会乱码（pack-installer.mjs 会校验 BOM）。

!ifndef SRC_ROOT
  !error "缺少 SRC_ROOT（仓库根路径），请经由 node dev/tool/pack-installer.mjs 构建"
!endif
!ifndef OUT_FILE
  !error "缺少 OUT_FILE（输出路径，必须是 ASCII 名），请经由 node dev/tool/pack-installer.mjs 构建"
!endif

SetCompressor /SOLID lzma
Unicode true
Name "北风 V0.0.1-alpha"
BrandingText "北风 · 离线阅读器"
OutFile "${OUT_FILE}"
InstallDir "$LOCALAPPDATA\北风"
InstallDirRegKey HKCU "Software\北风" "InstallDir"
RequestExecutionLevel user

!include "MUI2.nsh"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\北风"

!define PRODUCT_VERSION "0.0.1-alpha"
!define PRODUCT_PUBLISHER "bytelate@163.com"
!define PRODUCT_WEB "https://github.com/jugu513/beifeng-reader"

!define MUI_ICON "${SRC_ROOT}\北风.ico"
!define MUI_UNICON "${SRC_ROOT}\北风.ico"
!define MUI_FINISHPAGE_NOAUTOCLOSE
!define MUI_DIRECTORYPAGE_TEXT_TOP "安装位置（装在自己用户目录下，不需要管理员权限）："

!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro MUI_LANGUAGE "English"

Section "北风（必需）" SecMain
  SectionIn RO
  SetOutPath "$INSTDIR"

  ; 发布文件：与仓库根逐字一致，pack-installer.mjs 打包前已核对
  File "${SRC_ROOT}\北风V0.0.1-alpha.html"
  File "${SRC_ROOT}\启动北风.bat"
  File "${SRC_ROOT}\安装环境.bat"
  File "${SRC_ROOT}\校验文件.bat"
  File "${SRC_ROOT}\创建桌面快捷方式.bat"
  File "${SRC_ROOT}\README.md"
  File "${SRC_ROOT}\LICENSE"
  File "${SRC_ROOT}\北风.ico"

  WriteUninstaller "$INSTDIR\Uninstall.exe"

  ; 快捷方式：主入口是启动器（本地服务模式，书才存得住）
  CreateDirectory "$SMPROGRAMS\北风"
  CreateShortCut "$SMPROGRAMS\北风\北风.lnk" "$INSTDIR\启动北风.bat" "" "$INSTDIR\北风.ico" 0
  CreateShortCut "$SMPROGRAMS\北风\卸载北风.lnk" "$INSTDIR\Uninstall.exe" "" "$INSTDIR\北风.ico" 0
  CreateShortCut "$DESKTOP\北风.lnk" "$INSTDIR\启动北风.bat" "" "$INSTDIR\北风.ico" 0

  ; 「应用和功能」卸载入口
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "北风"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${PRODUCT_VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\北风.ico"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "${PRODUCT_PUBLISHER}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "URLInfoAbout" "${PRODUCT_WEB}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
  WriteRegStr HKCU "Software\北风" "InstallDir" "$INSTDIR"
SectionEnd

Section "Uninstall"
  Delete "$DESKTOP\北风.lnk"
  Delete "$SMPROGRAMS\北风\北风.lnk"
  Delete "$SMPROGRAMS\北风\卸载北风.lnk"
  RMDir "$SMPROGRAMS\北风"

  ; 只删安装时写入的文件；用户若在目录里放了自己的东西，目录保留
  Delete "$INSTDIR\北风V0.0.1-alpha.html"
  Delete "$INSTDIR\启动北风.bat"
  Delete "$INSTDIR\安装环境.bat"
  Delete "$INSTDIR\校验文件.bat"
  Delete "$INSTDIR\创建桌面快捷方式.bat"
  Delete "$INSTDIR\README.md"
  Delete "$INSTDIR\LICENSE"
  Delete "$INSTDIR\北风.ico"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"

  DeleteRegKey HKCU "${UNINSTALL_KEY}"
  DeleteRegKey HKCU "Software\北风"
SectionEnd
