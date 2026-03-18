import Intents
import UserNotifications

final class NotificationService: UNNotificationServiceExtension {
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
    guard let notificationType = payloadString(for: "type", in: payload),
          notificationType == "new_message" || notificationType == "mention" else {
      contentHandler(bestAttemptContent)
      return
    }

    Task {
      let senderDisplayName = request.content.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        ? "Someone"
        : request.content.title
      let senderAvatarUrl = payloadString(for: "senderAvatarUrl", in: payload)
      let conversationIdentifier =
        payloadString(for: "channelId", in: payload) ??
        payloadString(for: "groupId", in: payload)
      let groupName = payloadString(for: "groupName", in: payload)
      let messageBody = request.content.body

      do {
        let senderImage = try await fetchSenderImage(from: senderAvatarUrl)
        let updatedContent = try await createCommunicationNotification(
          from: bestAttemptContent,
          senderDisplayName: senderDisplayName,
          senderImage: senderImage,
          messageBody: messageBody,
          conversationIdentifier: conversationIdentifier,
          groupName: groupName
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
