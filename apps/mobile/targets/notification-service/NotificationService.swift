import Intents
import UserNotifications

final class NotificationService: UNNotificationServiceExtension {
  private enum PayloadKey {
    static let notificationType = "type"
    static let communicationEnabled = "communicationNotification"
    static let notificationStyle = "notificationStyle"
    static let notificationIntent = "notificationIntent"
    static let senderName = "senderName"
    static let senderDisplayName = "senderDisplayName"
    static let communicationSenderName = "communicationSenderName"
    static let communicationAvatarUrl = "communicationAvatarUrl"
    static let notificationImageUrl = "notificationImageUrl"
    static let senderAvatarUrl = "senderAvatarUrl"
    static let groupAvatarUrl = "groupAvatarUrl"
    static let imageUrl = "imageUrl"
    static let communicationBody = "communicationBody"
    static let messagePreview = "messagePreview"
    static let communicationConversationId = "communicationConversationId"
    static let channelId = "channelId"
    static let groupId = "groupId"
    static let communicationGroupName = "communicationGroupName"
    static let groupName = "groupName"
  }

  private struct CommunicationContent {
    let senderDisplayName: String
    let avatarImageUrl: String?
    let messageBody: String
    let conversationIdentifier: String?
    let groupName: String?
  }

  // Backward compatibility for existing server payloads.
  private let legacyCommunicationTypes: Set<String> = ["new_message", "mention"]

  private var contentHandler: ((UNNotificationContent) -> Void)?
  private var bestAttemptContent: UNMutableNotificationContent?

  override func didReceive(
    _ request: UNNotificationRequest,
    withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
  ) {
    self.contentHandler = contentHandler
    guard let bestAttemptContent = (request.content.mutableCopy() as? UNMutableNotificationContent) else {
      contentHandler(request.content)
      return
    }

    self.bestAttemptContent = bestAttemptContent

    guard #available(iOSApplicationExtension 15.0, *) else {
      contentHandler(bestAttemptContent)
      return
    }

    let payload = extractPayload(from: request.content.userInfo)
    guard shouldPromoteToCommunication(payload: payload) else {
      contentHandler(bestAttemptContent)
      return
    }

    let communicationContent = buildCommunicationContent(
      payload: payload,
      fallbackContent: request.content
    )

    Task {
      do {
        let senderImage = try await fetchSenderImage(from: communicationContent.avatarImageUrl)
        let updatedContent = try await createCommunicationNotification(
          from: bestAttemptContent,
          senderDisplayName: communicationContent.senderDisplayName,
          senderImage: senderImage,
          messageBody: communicationContent.messageBody,
          conversationIdentifier: communicationContent.conversationIdentifier,
          groupName: communicationContent.groupName
        )
        self.bestAttemptContent = updatedContent
        contentHandler(updatedContent)
      } catch {
        contentHandler(bestAttemptContent)
      }
    }
  }

  override func serviceExtensionTimeWillExpire() {
    if let contentHandler, let bestAttemptContent {
      contentHandler(bestAttemptContent)
    }
  }

  @available(iOSApplicationExtension 15.0, *)
  private func createCommunicationNotification(
    from content: UNMutableNotificationContent,
    senderDisplayName: String,
    senderImage: INImage?,
    messageBody: String,
    conversationIdentifier: String?,
    groupName: String?
  ) async throws -> UNMutableNotificationContent {
    let sender = INPerson(
      personHandle: nil,
      nameComponents: nil,
      displayName: senderDisplayName,
      image: senderImage,
      contactIdentifier: nil,
      customIdentifier: senderDisplayName,
      isMe: false,
      suggestionType: .none
    )

    let me = INPerson(
      personHandle: nil,
      nameComponents: nil,
      displayName: nil,
      image: nil,
      contactIdentifier: nil,
      customIdentifier: nil,
      isMe: true,
      suggestionType: .none
    )

    let intent = INSendMessageIntent(
      recipients: [me],
      outgoingMessageType: .outgoingMessageText,
      content: messageBody,
      speakableGroupName: groupName.map { INSpeakableString(spokenPhrase: $0) },
      conversationIdentifier: conversationIdentifier,
      serviceName: nil,
      sender: sender,
      attachments: nil
    )

    if let senderImage {
      intent.setImage(senderImage, forParameterNamed: \.sender)
    }

    let interaction = INInteraction(intent: intent, response: nil)
    interaction.direction = .incoming
    try await donate(interaction: interaction)

    let updatedContent = try content.updating(from: intent)
    guard let mutableUpdatedContent = updatedContent.mutableCopy() as? UNMutableNotificationContent else {
      throw NSError(domain: "NotificationService", code: 1)
    }

    return mutableUpdatedContent
  }

  private func donate(interaction: INInteraction) async throws {
    try await withCheckedThrowingContinuation { continuation in
      interaction.donate { error in
        if let error {
          continuation.resume(throwing: error)
          return
        }
        continuation.resume()
      }
    }
  }

  @available(iOSApplicationExtension 15.0, *)
  private func fetchSenderImage(from avatarUrl: String?) async throws -> INImage? {
    guard let avatarUrl,
          let url = URL(string: avatarUrl) else {
      return nil
    }

    let (data, response) = try await URLSession.shared.data(from: url)
    if let httpResponse = response as? HTTPURLResponse, !(200...299).contains(httpResponse.statusCode) {
      return nil
    }
    guard !data.isEmpty else {
      return nil
    }

    return INImage(imageData: data)
  }

  private func extractPayload(from userInfo: [AnyHashable: Any]) -> [String: Any] {
    var payload: [String: Any] = [:]

    for (key, value) in userInfo {
      guard let stringKey = key as? String else {
        continue
      }
      payload[stringKey] = value
    }

    if let bodyPayload = userInfo["body"] as? [String: Any] {
      payload.merge(bodyPayload, uniquingKeysWith: { _, new in new })
    } else if let bodyString = userInfo["body"] as? String,
              let bodyData = bodyString.data(using: .utf8),
              let bodyPayload = try? JSONSerialization.jsonObject(with: bodyData) as? [String: Any] {
      payload.merge(bodyPayload, uniquingKeysWith: { _, new in new })
    }

    return payload
  }

  private func shouldPromoteToCommunication(payload: [String: Any]) -> Bool {
    if let explicit = payloadBool(for: PayloadKey.communicationEnabled, in: payload) {
      return explicit
    }

    if let style = payloadString(for: PayloadKey.notificationStyle, in: payload)?.lowercased() {
      if style == "communication" {
        return true
      }
      if style == "standard" || style == "default" {
        return false
      }
    }

    if let intent = payloadString(for: PayloadKey.notificationIntent, in: payload)?.lowercased() {
      if intent == "communication" || intent == "in_send_message" {
        return true
      }
    }

    guard let notificationType = payloadString(for: PayloadKey.notificationType, in: payload) else {
      return false
    }
    return legacyCommunicationTypes.contains(notificationType)
  }

  private func buildCommunicationContent(
    payload: [String: Any],
    fallbackContent: UNNotificationContent
  ) -> CommunicationContent {
    let fallbackTitle = fallbackContent.title.trimmingCharacters(in: .whitespacesAndNewlines)
    let senderDisplayName =
      payloadString(for: PayloadKey.communicationSenderName, in: payload) ??
      payloadString(for: PayloadKey.senderDisplayName, in: payload) ??
      (!fallbackTitle.isEmpty ? fallbackTitle : nil) ??
      payloadString(for: PayloadKey.senderName, in: payload) ??
      "Someone"

    let avatarImageUrl =
      payloadString(for: PayloadKey.communicationAvatarUrl, in: payload) ??
      payloadString(for: PayloadKey.notificationImageUrl, in: payload) ??
      payloadString(for: PayloadKey.senderAvatarUrl, in: payload) ??
      payloadString(for: PayloadKey.groupAvatarUrl, in: payload) ??
      payloadString(for: PayloadKey.imageUrl, in: payload) ??
      nestedPayloadString(keys: ["richContent", "image"], in: payload)

    let messageBody =
      payloadString(for: PayloadKey.communicationBody, in: payload) ??
      payloadString(for: PayloadKey.messagePreview, in: payload) ??
      fallbackContent.body

    let conversationIdentifier =
      payloadString(for: PayloadKey.communicationConversationId, in: payload) ??
      payloadString(for: PayloadKey.channelId, in: payload) ??
      payloadString(for: PayloadKey.groupId, in: payload)

    let groupName =
      payloadString(for: PayloadKey.communicationGroupName, in: payload) ??
      payloadString(for: PayloadKey.groupName, in: payload)

    return CommunicationContent(
      senderDisplayName: senderDisplayName,
      avatarImageUrl: avatarImageUrl,
      messageBody: messageBody,
      conversationIdentifier: conversationIdentifier,
      groupName: groupName
    )
  }

  private func nestedPayloadString(keys: [String], in payload: [String: Any]) -> String? {
    guard !keys.isEmpty else {
      return nil
    }

    var current: Any? = payload
    for key in keys {
      guard let dictionary = current as? [String: Any] else {
        return nil
      }
      current = dictionary[key]
    }

    if let value = current as? String {
      let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
      return trimmed.isEmpty ? nil : trimmed
    }
    if let value = current as? NSNumber {
      return value.stringValue
    }
    return nil
  }

  private func payloadBool(for key: String, in payload: [String: Any]) -> Bool? {
    if let value = payload[key] as? Bool {
      return value
    }

    if let value = payload[key] as? NSNumber {
      return value.boolValue
    }

    if let value = payload[key] as? String {
      let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
      if ["true", "1", "yes", "y"].contains(normalized) {
        return true
      }
      if ["false", "0", "no", "n"].contains(normalized) {
        return false
      }
    }

    return nil
  }

  private func payloadString(for key: String, in payload: [String: Any]) -> String? {
    if let value = payload[key] as? String {
      let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
      return trimmed.isEmpty ? nil : trimmed
    }

    if let value = payload[key] as? NSNumber {
      return value.stringValue
    }

    return nil
  }
}
