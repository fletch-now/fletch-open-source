export function modelKeyStatus(status: string): string {
  switch (status) {
    case "accessible":
      return "Model access checked";
    case "unauthorized":
      return "Key rejected. Replace it with an active provider key.";
    case "model_unavailable":
      return "Model unavailable. Check the model ID and your access.";
    case "rate_limited":
      return "Provider rate limit reached. Try the access check again shortly.";
    case "unavailable":
      return "Provider could not be reached. Check access again.";
    case "revoked":
      return "Connection removed";
    default:
      return "Access has not been checked";
  }
}
