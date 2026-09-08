// Read browser credentials through a stable executable with explicit setup authorization.
import Foundation
import Security

let services: Set<String> = ["Chrome Safe Storage", "Arc Safe Storage", "Brave Safe Storage",
                              "Microsoft Edge Safe Storage", "Chromium Safe Storage"]
let arguments = CommandLine.arguments
guard arguments.count == 3, ["read", "authorize"].contains(arguments[1]),
      services.contains(arguments[2]) else {
    FileHandle.standardError.write(Data("Unsupported credential request.\n".utf8))
    exit(2)
}

// File-based keychains require process-wide suppression in addition to the query flag.
let interactive = arguments[1] == "authorize"
var previous: DarwinBoolean = false
guard SecKeychainGetUserInteractionAllowed(&previous) == errSecSuccess,
      SecKeychainSetUserInteractionAllowed(interactive) == errSecSuccess else {
    exit(3)
}
let query: [String: Any] = [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: arguments[2],
    kSecReturnData as String: true,
    kSecMatchLimit as String: kSecMatchLimitOne,
    kSecUseAuthenticationUI as String: interactive ? kSecUseAuthenticationUIAllow : kSecUseAuthenticationUIFail,
]
var result: CFTypeRef?
let status = SecItemCopyMatching(query as CFDictionary, &result)
let restored = SecKeychainSetUserInteractionAllowed(previous.boolValue)
guard status == errSecSuccess, restored == errSecSuccess, let secret = result as? Data else {
    FileHandle.standardError.write(Data("Credential access unavailable.\n".utf8))
    exit(3)
}
// The caller captures this pipe; credential contents never enter diagnostics or arguments.
FileHandle.standardOutput.write(secret)
