using System.Text.Json;

namespace Portal.Api;

public static class UpstreamJson
{
    public static async Task<JsonElement> Read(HttpContent content, CancellationToken ct)
    {
        // 202 retry acknowledgments and 404 responses can legitimately have no body.
        if (content.Headers.ContentLength == 0) return JsonSerializer.SerializeToElement<object?>(null);
        return await content.ReadFromJsonAsync<JsonElement>(ct);
    }
}
