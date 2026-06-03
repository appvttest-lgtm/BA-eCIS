#include <windows.h>
#include <shellapi.h>

#include <string>

namespace {

std::wstring directoryOfExecutable() {
  wchar_t path[MAX_PATH];
  DWORD length = GetModuleFileNameW(nullptr, path, MAX_PATH);
  if (length == 0 || length == MAX_PATH) {
    return L".";
  }

  std::wstring fullPath(path, length);
  size_t slash = fullPath.find_last_of(L"\\/");
  if (slash == std::wstring::npos) {
    return L".";
  }
  return fullPath.substr(0, slash);
}

bool fileExists(const std::wstring& path) {
  DWORD attributes = GetFileAttributesW(path.c_str());
  return attributes != INVALID_FILE_ATTRIBUTES &&
         (attributes & FILE_ATTRIBUTE_DIRECTORY) == 0;
}

void showError(const std::wstring& message) {
  MessageBoxW(nullptr, message.c_str(), L"Barcode Auditer", MB_OK | MB_ICONERROR);
}

bool startLocalServer(const std::wstring& appDir) {
  const std::wstring nodePath = appDir + L"\\node\\node.exe";
  const std::wstring serverPath = appDir + L"\\server.mjs";

  if (!fileExists(nodePath)) {
    showError(L"Portable Node runtime was not found at node\\node.exe.");
    return false;
  }

  if (!fileExists(serverPath)) {
    showError(L"Local server file was not found at server.mjs.");
    return false;
  }

  std::wstring commandLine = L"\"" + nodePath + L"\" \"" + serverPath + L"\"";
  std::wstring commandLineBuffer = commandLine;

  STARTUPINFOW startupInfo = {};
  startupInfo.cb = sizeof(startupInfo);
  startupInfo.dwFlags = STARTF_USESHOWWINDOW;
  startupInfo.wShowWindow = SW_SHOWMINIMIZED;

  PROCESS_INFORMATION processInfo = {};
  BOOL created = CreateProcessW(
      nullptr,
      &commandLineBuffer[0],
      nullptr,
      nullptr,
      FALSE,
      CREATE_NEW_CONSOLE,
      nullptr,
      appDir.c_str(),
      &startupInfo,
      &processInfo);

  if (!created) {
    showError(L"Unable to start the bundled local Node server.");
    return false;
  }

  CloseHandle(processInfo.hThread);
  CloseHandle(processInfo.hProcess);
  return true;
}

}  // namespace

int APIENTRY wWinMain(HINSTANCE, HINSTANCE, LPWSTR, int) {
  const std::wstring appDir = directoryOfExecutable();
  const std::wstring distIndex = appDir + L"\\dist\\index.html";

  if (!fileExists(distIndex)) {
    showError(L"The prebuilt web app was not found at dist\\index.html.");
    return 1;
  }

  if (!startLocalServer(appDir)) {
    return 1;
  }

  Sleep(1800);
  ShellExecuteW(
      nullptr,
      L"open",
      L"http://127.0.0.1:3000",
      nullptr,
      nullptr,
      SW_SHOWNORMAL);

  return 0;
}
