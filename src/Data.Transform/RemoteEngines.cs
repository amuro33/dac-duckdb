using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using Streaming.Core;

namespace Data.Transform;

public record ResultPart(string Name, long Rows, long Offset, long Bytes, string Sha256);
public record ResultManifest(int SchemaVersion, string Engine, long RowCount, double EngineMs, List<ResultPart> Files, JsonElement Details);

public sealed class RemoteEngines(IHttpClientFactory clients)
{
    public async Task<object> Status(CancellationToken ct)
    {
        try
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
            timeout.CancelAfter(TimeSpan.FromSeconds(8));
            return await clients.CreateClient("engines").GetFromJsonAsync<JsonElement>("engines", timeout.Token);
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException)
        {
            return new { spark = new { available = false }, datafusion = new { available = false }, drill = new { available = false } };
        }
    }

    public async Task<ResultManifest> Execute(Dataset dataset, string directory, CancellationToken ct)
    {
        var http = clients.CreateClient("engines");
        var prefix = $"jobs/{dataset.Id}/";
        foreach (var source in new[] { "eds", "defects" })
        {
            var path = Path.Combine(directory, source + ".parquet");
            await using var file = File.OpenRead(path);
            var hash = Convert.ToHexString(await SHA256.HashDataAsync(file, ct)).ToLowerInvariant();
            file.Position = 0;
            using var content = new StreamContent(file);
            content.Headers.Add("x-content-sha256", hash);
            using var response = await http.PutAsync(prefix + "inputs/" + source, content, ct);
            await Ensure(response, ct);
        }
        using var executed = await http.PostAsJsonAsync(prefix + "execute", dataset.Config, Wire.Json, ct);
        await Ensure(executed, ct);
        var manifest = await executed.Content.ReadFromJsonAsync<ResultManifest>(Wire.Json, ct)
            ?? throw new InvalidDataException("Engine returned no result manifest");
        ValidateManifest(manifest, dataset.Config.Engine);
        var staging = Path.Combine(directory, "parts.partial");
        var final = Path.Combine(directory, "parts");
        if (Directory.Exists(staging)) Directory.Delete(staging, true);
        Directory.CreateDirectory(staging);
        for (var i = 0; i < manifest.Files.Count; i++)
        {
            var part = manifest.Files[i];
            var name = $"part-{i:D5}.parquet";
            var path = Path.Combine(staging, name);
            using var response = await http.GetAsync(prefix + "files/" + i, HttpCompletionOption.ResponseHeadersRead, ct);
            await Ensure(response, ct);
            await using (var output = File.Create(path))
                await response.Content.CopyToAsync(output, ct);
            await using var input = File.OpenRead(path);
            if (input.Length != part.Bytes || !Convert.ToHexString(await SHA256.HashDataAsync(input, ct)).Equals(part.Sha256, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("Engine result transfer checksum mismatch");
            manifest.Files[i] = part with { Name = name };
        }
        await File.WriteAllTextAsync(Path.Combine(staging, "manifest.json"), Wire.Serialize(manifest), ct);
        if (Directory.Exists(final)) Directory.Delete(final, true);
        Directory.Move(staging, final);
        return manifest;
    }

    public static void ValidateManifest(ResultManifest manifest, string engine)
    {
        if (manifest.SchemaVersion != 1 || manifest.Engine != engine || manifest.RowCount < 0 || manifest.RowCount > int.MaxValue || manifest.Files is null || manifest.Files.Count is < 1 or > 10000)
            throw new InvalidDataException("Invalid engine result manifest");
        long count = 0;
        foreach (var part in manifest.Files)
        {
            if (part.Rows < 0 || part.Offset != count || part.Bytes <= 0 || part.Sha256 is null || part.Sha256.Length != 64 || !part.Sha256.All(Uri.IsHexDigit))
                throw new InvalidDataException("Incomplete engine result manifest");
            count = checked(count + part.Rows);
        }
        if (count != manifest.RowCount) throw new InvalidDataException("Engine result row count mismatch");
    }

    static async Task Ensure(HttpResponseMessage response, CancellationToken ct)
    {
        if (response.IsSuccessStatusCode) return;
        var error = await response.Content.ReadAsStringAsync(ct);
        throw new HttpRequestException($"Analytics engine returned {(int)response.StatusCode}: {error[..Math.Min(error.Length, 1500)]}");
    }
}
