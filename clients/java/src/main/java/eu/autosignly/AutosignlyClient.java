package eu.autosignly;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ThreadLocalRandom;

import eu.autosignly.Models.Attachment;
import eu.autosignly.Models.Credentials;
import eu.autosignly.Models.Document;
import eu.autosignly.Models.DocumentSummary;
import eu.autosignly.Models.Page;
import eu.autosignly.Models.PageInfo;
import eu.autosignly.Models.Signer;
import eu.autosignly.Models.SigningRequestResult;
import eu.autosignly.Models.Tag;

/**
 * Client for the Autosignly API.
 *
 * <p>Credentials are a key and secret pair created in the Autosignly
 * application. Each environment, production or sandbox, has its own pair, and
 * the pair decides which environment a call operates on.
 *
 * <p>The secret must never reach a browser or a mobile app. This client is meant
 * to run on your own server. Instances are immutable and safe to share between
 * threads.
 */
public final class AutosignlyClient {

    public static final String PRODUCTION_BASE_URL = "https://app.autosignly.eu/api";
    private static final String API_PREFIX = "/publics/v1";
    private static final String VERSION = "0.1.0";

    private static final Set<Integer> RETRY_STATUSES = Set.of(429, 500, 502, 503, 504);
    private static final double MAX_RETRY_DELAY_SECONDS = 60;
    private static final Set<String> IDEMPOTENT_METHODS = Set.of("GET", "DELETE");

    private final String baseUrl;
    private final String apiKey;
    private final String apiSecret;
    private final Duration timeout;
    private final int maxRetries;
    private final HttpClient http;
    private final ObjectMapper mapper = new ObjectMapper();

    private AutosignlyClient(Builder builder) {
        this.baseUrl = builder.baseUrl.replaceAll("/+$", "");
        this.apiKey = builder.apiKey;
        this.apiSecret = builder.apiSecret;
        this.timeout = builder.timeout;
        this.maxRetries = Math.max(0, builder.maxRetries);
        this.http = builder.http != null
                ? builder.http
                : HttpClient.newBuilder().connectTimeout(builder.timeout).build();
    }

    public static Builder builder(String apiKey, String apiSecret) {
        return new Builder(apiKey, apiSecret);
    }

    /** A client pointing at production, with the default timeout and retries. */
    public static AutosignlyClient of(String apiKey, String apiSecret) {
        return builder(apiKey, apiSecret).build();
    }

    public static final class Builder {
        private final String apiKey;
        private final String apiSecret;
        private String baseUrl = PRODUCTION_BASE_URL;
        private Duration timeout = Duration.ofSeconds(30);
        private int maxRetries = 2;
        private HttpClient http;

        private Builder(String apiKey, String apiSecret) {
            if (apiKey == null || apiKey.isBlank() || apiSecret == null || apiSecret.isBlank()) {
                throw new IllegalArgumentException("apiKey and apiSecret are required");
            }
            this.apiKey = apiKey;
            this.apiSecret = apiSecret;
        }

        /** Point at another environment, for example a local instance. */
        public Builder baseUrl(String baseUrl) { this.baseUrl = baseUrl; return this; }

        public Builder timeout(Duration timeout) { this.timeout = timeout; return this; }

        /** How many times to retry a failed request. Zero disables retrying. */
        public Builder maxRetries(int maxRetries) { this.maxRetries = maxRetries; return this; }

        /** Supply your own HTTP client, for a proxy or a custom executor. */
        public Builder httpClient(HttpClient http) { this.http = http; return this; }

        public AutosignlyClient build() { return new AutosignlyClient(this); }
    }

    // -- credentials ---------------------------------------------------------

    /**
     * Report whether this key and secret pair is accepted.
     *
     * <p>Invalid credentials return {@code false} rather than throwing, mirroring
     * the API, which never answers this call with an authentication error so that
     * keys cannot be probed.
     */
    public boolean validateCredentials() {
        JsonNode payload = request("GET", "/api-key", null, null);
        return payload != null && payload.path("valid").asBoolean(false);
    }

    /**
     * Report which company and environment this key and secret resolve to.
     *
     * <p>Useful before a first call: it says whether the pair points at production
     * or at a sandbox, without touching any document.
     */
    public Credentials describeCredentials() {
        return read(request("GET", "/credentials", null, null), Credentials.class);
    }

    // -- documents -----------------------------------------------------------

    /** Return one page of documents belonging to this environment. */
    public Page<DocumentSummary> listDocuments(int page, int size, List<String> statuses) {
        return listDocuments(page, size, statuses, null);
    }

    /**
     * One page of documents, narrowed by status, by tag, or by both.
     *
     * <p>Several tags narrow the result: a document has to carry all of them. A tag
     * that does not exist yields an empty page rather than an error.
     */
    public Page<DocumentSummary> listDocuments(
            int page, int size, List<String> statuses, List<String> tagIds) {
        StringBuilder query = new StringBuilder("/documents?page=" + page + "&size=" + size);
        if (statuses != null) {
            for (String status : statuses) {
                query.append("&status=").append(status);
            }
        }
        if (tagIds != null) {
            for (String tagId : tagIds) {
                query.append("&tagId=").append(URLEncoder.encode(tagId, StandardCharsets.UTF_8));
            }
        }
        return toPage(request("GET", query.toString(), null, null), DocumentSummary.class);
    }

    /** The first page of documents, with the API's default page size. */
    public Page<DocumentSummary> listDocuments() {
        return listDocuments(0, 20, null);
    }

    /**
     * Walk every document, page by page.
     *
     * <p>Pages are fetched as the iterator advances, so a large environment does
     * not have to be held in memory at once.
     */
    public Iterable<DocumentSummary> iterateDocuments(int size, List<String> statuses) {
        return iterateDocuments(size, statuses, null);
    }

    /** Walk every document carrying all of the given tags, page by page. */
    public Iterable<DocumentSummary> iterateDocuments(int size, List<String> statuses, List<String> tagIds) {
        return () -> new Iterator<>() {
            private Page<DocumentSummary> current = listDocuments(0, size, statuses, tagIds);
            private int index = 0;

            @Override
            public boolean hasNext() {
                if (index < current.content().size()) {
                    return true;
                }
                if (!current.hasNext()) {
                    return false;
                }
                current = listDocuments(current.number() + 1, size, statuses, tagIds);
                index = 0;
                return !current.content().isEmpty();
            }

            @Override
            public DocumentSummary next() {
                return current.content().get(index++);
            }
        };
    }

    /** Return one document with its signers and a fresh link to its file. */
    public Document getDocument(String documentId) {
        return read(request("GET", "/documents/" + documentId, null, null), Document.class);
    }

    /**
     * Fetch the current file of a document.
     *
     * <p>Resolves a fresh link through {@link #getDocument} and downloads it. A
     * document still being signed can be downloaded too; it then carries only the
     * signatures collected so far.
     */
    public byte[] downloadDocument(String documentId) {
        Document document = getDocument(documentId);
        if (document.fileUrl() == null || document.fileUrl().isBlank()) {
            throw new AutosignlyException.NotFound(
                    "Document " + documentId + " has no file to download", 404, null, null);
        }

        return download(document.fileUrl(), documentId);
    }

    /**
     * Store a PDF as a document without sending it to anyone.
     *
     * <p>Returns the identifier of the created document. Use this when the document
     * needs attachments before it goes out: upload it, attach the files with
     * {@link #addAttachment}, then call {@link #sendForSigning}. A document that has
     * already been sent can no longer take attachments.
     */
    public String uploadPdf(byte[] pdf, String documentName, String fileName) {
        ObjectNode request = mapper.createObjectNode();
        request.put("documentName", documentName);

        byte[] multipart;
        String boundary = "autosignly-" + UUID.randomUUID();
        try {
            multipart = multipart(boundary, pdf, fileName == null ? "document.pdf" : fileName,
                    mapper.writeValueAsString(request));
        } catch (IOException e) {
            throw new AutosignlyException("Could not build the upload request", e);
        }

        JsonNode payload = request("POST", "/documents", null, new Multipart(boundary, multipart));
        return payload == null ? "" : payload.path("documentId").asText("");
    }

    // -- attachments ---------------------------------------------------------

    /** Return the attachments of a document, in the order they will merge. */
    public List<Attachment> listAttachments(String documentId) {
        JsonNode payload = request("GET", "/documents/" + documentId + "/attachments", null, null);
        return payload == null || payload.isNull()
                ? List.of()
                : mapper.convertValue(payload, new TypeReference<List<Attachment>>() {});
    }

    /**
     * Attach a file to a document that has not been sent for signing yet.
     *
     * <p>The file is converted to PDF and merged into the document when it is sent,
     * behind an index page carrying its checksum, so one signature covers the
     * document and everything attached to it. PDF, JPEG and PNG are accepted,
     * recognised from the content rather than the file name. Attachments merge in
     * the order they were added.
     */
    public Attachment addAttachment(String documentId, byte[] content, String fileName) {
        String boundary = "autosignly-" + UUID.randomUUID();
        byte[] multipart;
        try {
            multipart = filePart(boundary, content, fileName, contentType(fileName));
        } catch (IOException e) {
            throw new AutosignlyException("Could not build the attachment request", e);
        }

        return read(request("POST", "/documents/" + documentId + "/attachments", null,
                new Multipart(boundary, multipart)), Attachment.class);
    }

    /** Remove an attachment from a document not yet sent for signing. */
    public void deleteAttachment(String documentId, String attachmentId) {
        request("DELETE", "/documents/" + documentId + "/attachments/" + attachmentId, null, null);
    }

    /** Fetch one attachment converted to PDF — the rendition that gets merged. */
    public byte[] downloadAttachment(String documentId, String attachmentId) {
        Attachment attachment = listAttachments(documentId).stream()
                .filter(candidate -> attachmentId.equals(candidate.id()))
                .findFirst()
                .orElseThrow(() -> new AutosignlyException.NotFound(
                        "Document " + documentId + " has no attachment " + attachmentId, 404, null, null));

        if (attachment.fileUrl() == null || attachment.fileUrl().isBlank()) {
            throw new AutosignlyException.NotFound(
                    "Attachment " + attachmentId + " is not converted yet", 404, null, null);
        }
        return download(attachment.fileUrl(), attachmentId);
    }

    /** Send an existing document to the given signers. */
    public SigningRequestResult sendForSigning(String documentId, SigningOptions options) {
        ObjectNode body = options.toJson(mapper);
        return read(request("POST", "/documents/" + documentId + "/signings", body, null),
                SigningRequestResult.class);
    }

    /**
     * Upload a PDF and send it for signature in one call.
     *
     * <p>Returns the identifier of the created document. Signing links are
     * e-mailed to the signers directly.
     */
    public String uploadAndSign(byte[] pdf, String documentName, String fileName, SigningOptions options) {
        ObjectNode request = options.toJson(mapper);
        request.put("documentName", documentName);

        byte[] multipart;
        String boundary = "autosignly-" + UUID.randomUUID();
        try {
            multipart = multipart(boundary, pdf, fileName == null ? "document.pdf" : fileName,
                    mapper.writeValueAsString(request));
        } catch (IOException e) {
            throw new AutosignlyException("Could not build the upload request", e);
        }

        JsonNode payload = request("POST", "/documents/signings", null,
                new Multipart(boundary, multipart));
        return payload == null ? "" : payload.path("documentId").asText("");
    }

    // -- tags ----------------------------------------------------------------

    /** Return one page of the company tag pool for this environment. */
    public Page<Tag> listTags(int page, int size) {
        return toPage(request("GET", "/tags?page=" + page + "&size=" + size, null, null), Tag.class);
    }

    /** Add a tag to the company pool, or return the existing one with that name. */
    public Tag createTag(String name) {
        ObjectNode body = mapper.createObjectNode().put("name", name);
        return read(request("POST", "/tags", body, null), Tag.class);
    }

    /** Remove a tag from the pool and from every document carrying it. */
    public void deleteTag(String tagId) {
        request("DELETE", "/tags/" + tagId, null, null);
    }

    /**
     * Replace the whole tag set of a document.
     *
     * <p>Tags left out are removed. Names that are not in the pool yet are added
     * to it. Passing empty lists clears every tag.
     */
    public List<Tag> setDocumentTags(String documentId, List<String> tagIds, List<String> names) {
        ObjectNode body = mapper.createObjectNode();
        if (tagIds != null) {
            body.set("tagIds", mapper.valueToTree(tagIds));
        }
        if (names != null) {
            body.set("names", mapper.valueToTree(names));
        }
        JsonNode payload = request("PUT", "/documents/" + documentId + "/tags", body, null);
        return payload == null
                ? List.of()
                : mapper.convertValue(payload, new TypeReference<List<Tag>>() {});
    }

    // -- transport -----------------------------------------------------------

    private byte[] download(String url, String subject) {
        HttpRequest download = HttpRequest.newBuilder(URI.create(url))
                .timeout(timeout)
                .GET()
                .build();
        try {
            HttpResponse<byte[]> response = http.send(download, HttpResponse.BodyHandlers.ofByteArray());
            if (response.statusCode() >= 400) {
                throw toError(response.statusCode(), new String(response.body(), StandardCharsets.UTF_8), null);
            }
            return response.body();
        } catch (IOException e) {
            throw new AutosignlyException.Connection("Could not download " + subject, e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new AutosignlyException.Connection("Interrupted while downloading " + subject, e);
        }
    }

    private record Multipart(String boundary, byte[] body) {}

    private JsonNode request(String method, String path, JsonNode jsonBody, Multipart multipart) {
        URI url = URI.create(baseUrl + API_PREFIX + path);

        Exception lastFailure = null;
        for (int attempt = 0; attempt <= maxRetries; attempt++) {
            HttpRequest.Builder builder = HttpRequest.newBuilder(url)
                    .timeout(timeout)
                    .header("X-API-KEY", apiKey)
                    .header("X-API-SECRET", apiSecret)
                    .header("Accept", "application/json")
                    .header("User-Agent", "autosignly-java/" + VERSION);

            if (!IDEMPOTENT_METHODS.contains(method)) {
                builder.header("Idempotency-Key", UUID.randomUUID().toString());
            }

            if (multipart != null) {
                builder.header("Content-Type", "multipart/form-data; boundary=" + multipart.boundary())
                        .method(method, HttpRequest.BodyPublishers.ofByteArray(multipart.body()));
            } else if (jsonBody != null) {
                try {
                    builder.header("Content-Type", "application/json")
                            .method(method, HttpRequest.BodyPublishers.ofString(
                                    mapper.writeValueAsString(jsonBody), StandardCharsets.UTF_8));
                } catch (IOException e) {
                    throw new AutosignlyException("Could not serialise the request body", e);
                }
            } else {
                builder.method(method, HttpRequest.BodyPublishers.noBody());
            }

            HttpResponse<String> response;
            try {
                response = http.send(builder.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            } catch (IOException e) {
                lastFailure = e;
                if (attempt >= maxRetries) {
                    throw new AutosignlyException.Connection("Could not reach " + url, e);
                }
                sleep(backoff(attempt));
                continue;
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new AutosignlyException.Connection("Interrupted while calling " + url, e);
            }

            if (RETRY_STATUSES.contains(response.statusCode()) && attempt < maxRetries) {
                Double delay = retryDelay(response, attempt);
                if (delay != null) {
                    sleep(delay);
                    continue;
                }
            }

            if (response.statusCode() >= 400) {
                throw toError(response.statusCode(), response.body(), retryAfterSeconds(response));
            }
            return decode(response.body(), url);
        }

        throw new AutosignlyException.Connection("Could not reach " + url, lastFailure);
    }

    /**
     * Exponential backoff with jitter.
     *
     * <p>The jitter matters: without it every client retrying a shared outage
     * wakes up at the same moment and pushes the service back over.
     */
    private static double backoff(int attempt) {
        double ceiling = Math.min(MAX_RETRY_DELAY_SECONDS, 0.5 * Math.pow(2, attempt));
        return ThreadLocalRandom.current().nextDouble(ceiling / 2, ceiling);
    }

    /**
     * How long to wait before retrying, or {@code null} to give up now.
     *
     * <p>A rate-limited response carries the delay the API wants; anything longer
     * than the cap is reported to the caller instead of blocking the thread.
     */
    private static Double retryDelay(HttpResponse<?> response, int attempt) {
        if (response.statusCode() != 429) {
            return backoff(attempt);
        }
        Double retryAfter = retryAfterSeconds(response);
        if (retryAfter == null) {
            return backoff(attempt);
        }
        return retryAfter > MAX_RETRY_DELAY_SECONDS ? null : retryAfter;
    }

    private static Double retryAfterSeconds(HttpResponse<?> response) {
        return response.headers().firstValue("Retry-After")
                .map(String::trim)
                .map(raw -> {
                    try {
                        return Math.max(0, Double.parseDouble(raw));
                    } catch (NumberFormatException e) {
                        return null;
                    }
                })
                .orElse(null);
    }

    private static void sleep(double seconds) {
        try {
            Thread.sleep((long) (seconds * 1000));
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new AutosignlyException.Connection("Interrupted while waiting to retry", e);
        }
    }

    private JsonNode decode(String body, URI url) {
        if (body == null || body.isBlank()) {
            return null;
        }
        try {
            return mapper.readTree(body);
        } catch (IOException e) {
            throw new AutosignlyException("Expected JSON from " + url, e);
        }
    }

    private AutosignlyException toError(int status, String body, Double retryAfter) {
        String errorType = null;
        String errorId = null;
        String info = null;
        try {
            JsonNode parsed = mapper.readTree(body);
            errorType = parsed.path("errorType").asText(null);
            errorId = parsed.path("errorId").asText(null);
            info = parsed.path("info").asText(null);
        } catch (Exception e) {
            info = body == null || body.isBlank() ? null : body.substring(0, Math.min(200, body.length()));
        }

        String message = info != null ? info : "Request failed with status " + status;
        return switch (status) {
            case 401 -> new AutosignlyException.Authentication(message, status, errorType, errorId);
            case 403 -> new AutosignlyException.PermissionDenied(message, status, errorType, errorId);
            case 404 -> new AutosignlyException.NotFound(message, status, errorType, errorId);
            case 429 -> new AutosignlyException.RateLimit(message, status, errorType, errorId, retryAfter);
            default -> status >= 500
                    ? new AutosignlyException.Server(message, status, errorType, errorId)
                    : new AutosignlyException.Validation(message, status, errorType, errorId);
        };
    }

    private <T> T read(JsonNode payload, Class<T> type) {
        return mapper.convertValue(payload == null ? mapper.createObjectNode() : payload, type);
    }

    private <T> Page<T> toPage(JsonNode payload, Class<T> type) {
        if (payload == null) {
            return new Page<>(List.of(), 0, 0, 0, 0);
        }
        List<T> content = new ArrayList<>();
        for (JsonNode item : payload.path("content")) {
            content.add(mapper.convertValue(item, type));
        }
        PageInfo info = payload.has("page")
                ? mapper.convertValue(payload.get("page"), PageInfo.class)
                : new PageInfo(0, content.size(), content.size(), content.isEmpty() ? 0 : 1);
        return new Page<>(content, info.number(), info.size(), info.totalElements(), info.totalPages());
    }

    private static byte[] multipart(String boundary, byte[] pdf, String fileName, String requestJson)
            throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        writeFilePart(out, boundary, pdf, fileName, "application/pdf");
        out.write(("\r\n--" + boundary + "\r\n").getBytes(StandardCharsets.UTF_8));
        out.write("Content-Disposition: form-data; name=\"request\"\r\n".getBytes(StandardCharsets.UTF_8));
        out.write("Content-Type: application/json\r\n\r\n".getBytes(StandardCharsets.UTF_8));
        out.write(requestJson.getBytes(StandardCharsets.UTF_8));
        out.write(("\r\n--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8));
        return out.toByteArray();
    }

    private static byte[] filePart(String boundary, byte[] content, String fileName, String contentType)
            throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        writeFilePart(out, boundary, content, fileName, contentType);
        out.write(("\r\n--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8));
        return out.toByteArray();
    }

    private static void writeFilePart(
            ByteArrayOutputStream out, String boundary, byte[] content, String fileName, String contentType)
            throws IOException {
        out.write(("--" + boundary + "\r\n").getBytes(StandardCharsets.UTF_8));
        out.write(("Content-Disposition: form-data; name=\"file\"; filename=\"" + fileName + "\"\r\n")
                .getBytes(StandardCharsets.UTF_8));
        out.write(("Content-Type: " + contentType + "\r\n\r\n").getBytes(StandardCharsets.UTF_8));
        out.write(content);
    }

    /** The server detects the real format from the bytes; this is only a hint. */
    private static String contentType(String fileName) {
        String lower = fileName == null ? "" : fileName.toLowerCase(Locale.ROOT);
        if (lower.endsWith(".pdf")) return "application/pdf";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".png")) return "image/png";
        return "application/octet-stream";
    }

    /** What to ask for when sending a document to signers. */
    public record SigningOptions(
            List<Signer> signers,
            String signatureType,
            String signatureMode,
            String verificationMethod,
            String initiatorEmail,
            String initiatorLocale) {

        public static SigningOptions of(List<Signer> signers) {
            return new SigningOptions(signers, null, null, null, null, null);
        }

        public SigningOptions withSignature(String signatureType, String signatureMode) {
            return new SigningOptions(signers, signatureType, signatureMode, verificationMethod,
                    initiatorEmail, initiatorLocale);
        }

        public SigningOptions withVerificationMethod(String verificationMethod) {
            return new SigningOptions(signers, signatureType, signatureMode, verificationMethod,
                    initiatorEmail, initiatorLocale);
        }

        public SigningOptions withInitiator(String email, String locale) {
            return new SigningOptions(signers, signatureType, signatureMode, verificationMethod, email, locale);
        }

        ObjectNode toJson(ObjectMapper mapper) {
            ObjectNode body = mapper.createObjectNode();
            body.set("signers", mapper.valueToTree(signers == null ? List.of() : signers));
            if (signatureType != null) body.put("signatureType", signatureType);
            if (signatureMode != null) body.put("signatureMode", signatureMode);
            if (verificationMethod != null) body.put("verificationMethod", verificationMethod);
            if (initiatorEmail != null) {
                body.set("signingInitiatorData", mapper.valueToTree(
                        initiatorLocale == null
                                ? Map.of("email", initiatorEmail)
                                : Map.of("email", initiatorEmail, "locale", initiatorLocale)));
            }
            return body;
        }
    }
}
