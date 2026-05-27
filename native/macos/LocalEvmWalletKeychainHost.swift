import Foundation
import Security
import LocalAuthentication

let keychainService = "com.local_evm_wallet.keychain"

func readExact(_ count: Int) -> Data? {
    var data = Data()

    while data.count < count {
        let chunk = FileHandle.standardInput.readData(ofLength: count - data.count)

        if chunk.isEmpty {
            return data.isEmpty ? nil : data
        }

        data.append(chunk)
    }

    return data
}

func readMessage() -> [String: Any]? {
    guard let lengthData = readExact(4), lengthData.count == 4 else {
        return nil
    }

    let bytes = [UInt8](lengthData)

    let length =
        Int(bytes[0]) |
        Int(bytes[1]) << 8 |
        Int(bytes[2]) << 16 |
        Int(bytes[3]) << 24

    guard length > 0 else {
        return nil
    }

    guard let messageData = readExact(length), messageData.count == length else {
        return nil
    }

    do {
        let json = try JSONSerialization.jsonObject(with: messageData)
        return json as? [String: Any]
    } catch {
        return nil
    }
}

func writeMessage(_ object: [String: Any]) {
    do {
        let jsonData = try JSONSerialization.data(withJSONObject: object)

        var length = UInt32(jsonData.count).littleEndian
        let lengthData = Data(bytes: &length, count: 4)

        FileHandle.standardOutput.write(lengthData)
        FileHandle.standardOutput.write(jsonData)
    } catch {
        let fallback = #"{"ok":false,"error":"Failed to encode response"}"#.data(using: .utf8)!

        var length = UInt32(fallback.count).littleEndian
        let lengthData = Data(bytes: &length, count: 4)

        FileHandle.standardOutput.write(lengthData)
        FileHandle.standardOutput.write(fallback)
    }
}

func ok(_ data: [String: Any]) -> [String: Any] {
    return [
        "ok": true,
        "data": data
    ]
}

func fail(_ message: String) -> [String: Any] {
    return [
        "ok": false,
        "error": message
    ]
}

func statusMessage(_ status: OSStatus) -> String {
    if let message = SecCopyErrorMessageString(status, nil) {
        return message as String
    }

    return "OSStatus \(status)"
}

func isBiometryAvailable() -> [String: Any] {
    let context = LAContext()
    var error: NSError?

    let available = context.canEvaluatePolicy(
        .deviceOwnerAuthenticationWithBiometrics,
        error: &error
    )

    var biometryType = "none"

    if available {
        switch context.biometryType {
        case .touchID:
            biometryType = "touchID"
        case .faceID:
            biometryType = "faceID"
        default:
            biometryType = "unknown"
        }
    }

    return [
        "available": available,
        "platform": "macOS",
        "host": "com.local_evm_wallet.keychain",
        "biometryType": biometryType,
        "error": error?.localizedDescription ?? NSNull()
    ]
}

func authenticateWithBiometrics() -> (success: Bool, error: String?) {
    let context = LAContext()
    context.localizedReason = "Unlock Local EVM Wallet with Touch ID"

    var policyError: NSError?

    let canEvaluate = context.canEvaluatePolicy(
        .deviceOwnerAuthenticationWithBiometrics,
        error: &policyError
    )

    if !canEvaluate {
        return (
            false,
            policyError?.localizedDescription ?? "Biometric authentication is not available."
        )
    }

    let semaphore = DispatchSemaphore(value: 0)

    var authSuccess = false
    var authError: String?

    context.evaluatePolicy(
        .deviceOwnerAuthenticationWithBiometrics,
        localizedReason: "Unlock Local EVM Wallet with Touch ID"
    ) { success, error in
        authSuccess = success
        authError = error?.localizedDescription
        semaphore.signal()
    }

    semaphore.wait()

    return (authSuccess, authError)
}

func baseQuery(walletId: String) -> [String: Any] {
    return [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: keychainService,
        kSecAttrAccount as String: walletId
    ]
}

func storeVaultKey(walletId: String, vaultKeyBase64: String) -> [String: Any] {
    guard let vaultKeyData = Data(base64Encoded: vaultKeyBase64) else {
        return fail("Invalid vaultKeyBase64.")
    }

    SecItemDelete(baseQuery(walletId: walletId) as CFDictionary)

    var query = baseQuery(walletId: walletId)
    query[kSecValueData as String] = vaultKeyData
    query[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly

    let status = SecItemAdd(query as CFDictionary, nil)

    if status != errSecSuccess {
        return fail("Failed to store vault key: \(statusMessage(status))")
    }

    return ok([
        "stored": true,
        "walletId": walletId
    ])
}

func getVaultKey(walletId: String) -> [String: Any] {
    let auth = authenticateWithBiometrics()

    if !auth.success {
        return fail("Biometric authentication failed: \(auth.error ?? "Unknown error")")
    }

    var query = baseQuery(walletId: walletId)
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne

    var item: CFTypeRef?

    let status = SecItemCopyMatching(query as CFDictionary, &item)

    if status != errSecSuccess {
        return fail("Failed to get vault key: \(statusMessage(status))")
    }

    guard let data = item as? Data else {
        return fail("Vault key data is invalid.")
    }

    return ok([
        "walletId": walletId,
        "vaultKeyBase64": data.base64EncodedString()
    ])
}

func deleteVaultKey(walletId: String) -> [String: Any] {
    let status = SecItemDelete(baseQuery(walletId: walletId) as CFDictionary)

    if status != errSecSuccess && status != errSecItemNotFound {
        return fail("Failed to delete vault key: \(statusMessage(status))")
    }

    return ok([
        "deleted": true,
        "walletId": walletId
    ])
}

while let request = readMessage() {
    let type = request["type"] as? String

    switch type {
    case "isAvailable", "ping":
        writeMessage(ok(isBiometryAvailable()))

    case "storeVaultKey":
        guard let walletId = request["walletId"] as? String else {
            writeMessage(fail("walletId is required."))
            continue
        }

        guard let vaultKeyBase64 = request["vaultKeyBase64"] as? String else {
            writeMessage(fail("vaultKeyBase64 is required."))
            continue
        }

        writeMessage(storeVaultKey(walletId: walletId, vaultKeyBase64: vaultKeyBase64))

    case "getVaultKey":
        guard let walletId = request["walletId"] as? String else {
            writeMessage(fail("walletId is required."))
            continue
        }

        writeMessage(getVaultKey(walletId: walletId))

    case "deleteVaultKey":
        guard let walletId = request["walletId"] as? String else {
            writeMessage(fail("walletId is required."))
            continue
        }

        writeMessage(deleteVaultKey(walletId: walletId))

    default:
        writeMessage(fail("Unknown request type."))
    }
}
