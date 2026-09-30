using System.Text.Json;
using System.Text.Json.Serialization;

namespace WebTools.NativeHost.Services;

public sealed record UpdatePreparationRequest(int ProtocolVersion, string Operation, int ExpectedHostProcessId);
public sealed record UpdatePreparationResponse(int ProtocolVersion, bool Success, string? ErrorCode = null);

public static class UpdatePreparationProtocol
{
    public const int CurrentProtocolVersion = 1;
    public const string PrepareUpdateOperation = "prepare-update";
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        MaxDepth = 4,
    };

    public static string SerializeRequest(UpdatePreparationRequest request) => JsonSerializer.Serialize(request, JsonOptions);
    public static string SerializeResponse(UpdatePreparationResponse response) => JsonSerializer.Serialize(response, JsonOptions);

    public static bool TryParseRequest(
        string json,
        int expectedHostProcessId,
        out UpdatePreparationRequest? request,
        out string errorCode)
    {
        request = null;
        if (!TryReadObject(json, ["protocolVersion", "operation", "expectedHostProcessId"], out var document, out errorCode)) return false;
        using (document)
        {
            var root = document!.RootElement;
            if (!root.TryGetProperty("protocolVersion", out var version) || !version.TryGetInt32(out var parsedVersion)
                || parsedVersion != CurrentProtocolVersion)
            {
                errorCode = "PROTOCOL_VERSION";
                return false;
            }
            if (!root.TryGetProperty("operation", out var operationElement) || operationElement.ValueKind != JsonValueKind.String
                || operationElement.GetString() != PrepareUpdateOperation)
            {
                errorCode = "UNKNOWN_OPERATION";
                return false;
            }
            if (!root.TryGetProperty("expectedHostProcessId", out var processElement) || !processElement.TryGetInt32(out var processId) || processId <= 0)
            {
                errorCode = "INVALID_HOST_PID";
                return false;
            }
            if (processId != expectedHostProcessId)
            {
                errorCode = "HOST_PID_MISMATCH";
                return false;
            }

            request = new UpdatePreparationRequest(parsedVersion, PrepareUpdateOperation, processId);
            errorCode = string.Empty;
            return true;
        }
    }

    public static bool TryParseResponse(string json, out UpdatePreparationResponse? response, out string errorCode)
    {
        response = null;
        if (!TryReadObject(json, ["protocolVersion", "success", "errorCode"], out var document, out errorCode, allowOptional: ["errorCode"])) return false;
        using (document)
        {
            var root = document!.RootElement;
            if (!root.TryGetProperty("protocolVersion", out var version) || !version.TryGetInt32(out var parsedVersion)
                || parsedVersion != CurrentProtocolVersion)
            {
                errorCode = "PROTOCOL_VERSION";
                return false;
            }
            if (!root.TryGetProperty("success", out var successElement)
                || successElement.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
            {
                errorCode = "INVALID_RESPONSE";
                return false;
            }
            string? responseError = null;
            if (root.TryGetProperty("errorCode", out var errorElement))
            {
                if (errorElement.ValueKind != JsonValueKind.String || (responseError = errorElement.GetString()) is null || responseError.Length is 0 or > 64)
                {
                    errorCode = "INVALID_RESPONSE";
                    return false;
                }
            }
            var success = successElement.GetBoolean();
            if (success && responseError is not null)
            {
                errorCode = "INVALID_RESPONSE";
                return false;
            }
            response = new UpdatePreparationResponse(parsedVersion, success, responseError);
            errorCode = string.Empty;
            return true;
        }
    }

    private static bool TryReadObject(
        string json,
        IReadOnlyCollection<string> allowedProperties,
        out JsonDocument? document,
        out string errorCode,
        IReadOnlyCollection<string>? allowOptional = null)
    {
        document = null;
        try
        {
            document = JsonDocument.Parse(json, new JsonDocumentOptions { MaxDepth = 4 });
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object)
            {
                errorCode = "INVALID_REQUEST";
                document.Dispose();
                document = null;
                return false;
            }

            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (var property in root.EnumerateObject())
            {
                if (!allowedProperties.Contains(property.Name, StringComparer.Ordinal) || !seen.Add(property.Name))
                {
                    errorCode = "INVALID_REQUEST";
                    document.Dispose();
                    document = null;
                    return false;
                }
            }
            if (allowedProperties.Any(name => !(allowOptional?.Contains(name, StringComparer.Ordinal) ?? false) && !seen.Contains(name)))
            {
                errorCode = "INVALID_REQUEST";
                document.Dispose();
                document = null;
                return false;
            }

            errorCode = string.Empty;
            return true;
        }
        catch (JsonException)
        {
            document?.Dispose();
            document = null;
            errorCode = "INVALID_REQUEST";
            return false;
        }
    }
}
