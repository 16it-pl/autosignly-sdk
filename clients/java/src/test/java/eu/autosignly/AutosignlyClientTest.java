package eu.autosignly;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Consumer;

import eu.autosignly.Models.Document;
import eu.autosignly.Models.Signer;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Runs against a real HTTP server from the JDK rather than a mocked client, so
 * the transport — headers, multipart framing, retries — is exercised too.
 */
class AutosignlyClientTest {

    private HttpServer server;
    private AutosignlyClient client;
    private final List<Recorded> calls = new ArrayList<>();

    record Recorded(String method, String path, String query, String body, java.net.http.HttpHeaders headers) {}

    private Consumer<HttpExchange> handler = exchange -> respond(exchange, 200, "{}");

    @BeforeEach
    void start() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            byte[] body = exchange.getRequestBody().readAllBytes();
            calls.add(new Recorded(
                    exchange.getRequestMethod(),
                    exchange.getRequestURI().getPath(),
                    exchange.getRequestURI().getQuery(),
                    new String(body, StandardCharsets.UTF_8),
                    java.net.http.HttpHeaders.of(exchange.getRequestHeaders(), (a, b) -> true)));
            handler.accept(exchange);
        });
        server.start();

        client = AutosignlyClient.builder("api_key_test", "api_sct_test")
                .baseUrl("http://127.0.0.1:" + server.getAddress().getPort() + "/api")
                .maxRetries(0)
                .build();
    }

    @AfterEach
    void stop() {
        server.stop(0);
    }

    private void answer(int status, String json) {
        handler = exchange -> respond(exchange, status, json);
    }

    private static void respond(HttpExchange exchange, int status, String json) {
        try {
            byte[] body = json.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(status, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }

    @Test
    void sendsTheCredentialsAsHeaders() {
        answer(200, "{\"valid\":true}");

        assertThat(client.validateCredentials()).isTrue();
        assertThat(calls.get(0).path()).isEqualTo("/api/publics/v1/api-key");
        assertThat(calls.get(0).headers().firstValue("x-api-key")).contains("api_key_test");
        assertThat(calls.get(0).headers().firstValue("x-api-secret")).contains("api_sct_test");
    }

    @Test
    void invalidCredentialsDoNotThrow() {
        answer(200, "{\"valid\":false}");
        assertThat(client.validateCredentials()).isFalse();
    }

    @Test
    void describeCredentialsReportsTheEnvironment() {
        answer(200, "{\"valid\":true,\"companyId\":\"co-1\",\"environmentId\":\"env-1\",\"environmentType\":\"SANDBOX\"}");

        var credentials = client.describeCredentials();

        assertThat(calls.get(0).path()).endsWith("/credentials");
        assertThat(credentials.companyId()).isEqualTo("co-1");
        assertThat(credentials.environmentType()).isEqualTo("SANDBOX");
    }

    @Test
    void listDocumentsParsesThePageAndRepeatsTheStatusFilter() {
        answer(200, """
                {"content":[{"id":"d-1","name":"Umowa","status":"SIGNED","tags":[{"id":"t","name":"x"}]}],
                 "page":{"number":1,"size":5,"totalElements":6,"totalPages":2}}""");

        var page = client.listDocuments(1, 5, List.of("SIGNED", "GENERATED"));

        assertThat(calls.get(0).query()).isEqualTo("page=1&size=5&status=SIGNED&status=GENERATED");
        assertThat(page.totalElements()).isEqualTo(6);
        assertThat(page.content().get(0).name()).isEqualTo("Umowa");
        assertThat(page.content().get(0).tags().get(0).name()).isEqualTo("x");
        assertThat(page.hasNext()).isFalse();
    }

    @Test
    void iterateDocumentsFollowsThePages() {
        AtomicInteger call = new AtomicInteger();
        handler = exchange -> {
            int page = call.getAndIncrement();
            respond(exchange, 200, """
                    {"content":[{"id":"d-%d"}],"page":{"number":%d,"size":1,"totalElements":2,"totalPages":2}}"""
                    .formatted(page, page));
        };

        List<String> ids = new ArrayList<>();
        client.iterateDocuments(1, null).forEach(document -> ids.add(document.id()));

        assertThat(ids).containsExactly("d-0", "d-1");
    }

    @Test
    void getDocumentReadsSignerResponsesAndTheFileLink() {
        answer(200, """
                {"id":"d-1","status":"SIGNED","fileUrl":"http://files.test/d-1.pdf",
                 "signerResponses":[{"email":"anna@example.com","signingOrder":1,"country":"PL"}]}""");

        Document document = client.getDocument("d-1");

        assertThat(document.fileUrl()).isEqualTo("http://files.test/d-1.pdf");
        assertThat(document.signers()).singleElement()
                .satisfies(signer -> {
                    assertThat(signer.email()).isEqualTo("anna@example.com");
                    assertThat(signer.signingOrder()).isEqualTo(1);
                });
    }

    @Test
    void downloadDocumentResolvesAFreshLinkAndFetchesTheBytes() {
        handler = exchange -> {
            if (exchange.getRequestURI().getPath().endsWith("/documents/d-1")) {
                respond(exchange, 200, "{\"id\":\"d-1\",\"fileUrl\":\"http://127.0.0.1:"
                        + server.getAddress().getPort() + "/files/d-1.pdf\"}");
            } else {
                try {
                    byte[] pdf = {37, 80, 68, 70};
                    exchange.sendResponseHeaders(200, pdf.length);
                    exchange.getResponseBody().write(pdf);
                    exchange.close();
                } catch (IOException e) {
                    throw new IllegalStateException(e);
                }
            }
        };

        assertThat(client.downloadDocument("d-1")).containsExactly(37, 80, 68, 70);
    }

    @Test
    void downloadDocumentReportsADocumentWithNoFile() {
        answer(200, "{\"id\":\"d-1\"}");

        assertThatThrownBy(() -> client.downloadDocument("d-1"))
                .isInstanceOf(AutosignlyException.NotFound.class)
                .hasMessageContaining("no file");
    }

    @Test
    void uploadAndSignPostsThePdfAndTheRequestAsMultipart() {
        answer(200, "{\"documentId\":\"d-9\"}");

        String documentId = client.uploadAndSign(
                new byte[] {37, 80, 68, 70},
                "Umowa",
                "umowa.pdf",
                AutosignlyClient.SigningOptions
                        .of(List.of(Signer.of("Anna", "Nowak", "a@example.com", "PL").withOrder(1)))
                        .withSignature(Constants.SignatureType.SES, Constants.SignatureMode.SIGNATURES_CARD));

        assertThat(documentId).isEqualTo("d-9");
        Recorded call = calls.get(0);
        assertThat(call.headers().firstValue("content-type")).hasValueSatisfying(
                type -> assertThat(type).startsWith("multipart/form-data; boundary=autosignly-"));
        assertThat(call.body())
                .contains("name=\"file\"; filename=\"umowa.pdf\"")
                .contains("name=\"request\"")
                .contains("\"signatureMode\":\"SIGNATURES_CARD\"")
                .contains("\"order\":1");
    }

    @Test
    void aWriteCarriesAnIdempotencyKeyAndAReadDoesNot() {
        answer(200, "{\"id\":\"t-1\",\"name\":\"Umowy\"}");

        client.createTag("Umowy");
        client.listTags(0, 20);

        assertThat(calls.get(0).headers().firstValue("idempotency-key")).isPresent();
        assertThat(calls.get(1).headers().firstValue("idempotency-key")).isEmpty();
    }

    @Test
    void mapsStatusCodesOntoTypedExceptions() {
        record Case(int status, Class<? extends AutosignlyException> expected) {}
        for (Case testCase : List.of(
                new Case(401, AutosignlyException.Authentication.class),
                new Case(403, AutosignlyException.PermissionDenied.class),
                new Case(404, AutosignlyException.NotFound.class),
                new Case(400, AutosignlyException.Validation.class),
                new Case(500, AutosignlyException.Server.class))) {
            answer(testCase.status(), "{\"errorType\":\"X\",\"errorId\":\"e-1\",\"info\":\"nope\"}");

            assertThatThrownBy(() -> client.getDocument("d-1"))
                    .isInstanceOf(testCase.expected())
                    .hasMessage("nope");
        }
    }

    @Test
    void keepsTheApiErrorDetailsOnTheException() {
        answer(400, "{\"errorType\":\"INVALID_REQUEST\",\"errorId\":\"e-7\",\"info\":\"bad signer\"}");

        assertThatThrownBy(() -> client.getDocument("d-1"))
                .isInstanceOfSatisfying(AutosignlyException.class, error -> {
                    assertThat(error.errorType()).isEqualTo("INVALID_REQUEST");
                    assertThat(error.errorId()).isEqualTo("e-7");
                });
    }

    @Test
    void aRateLimitAskingForLongerThanTheCapIsReportedNotSleptOff() {
        AutosignlyClient retrying = AutosignlyClient.builder("k", "s")
                .baseUrl("http://127.0.0.1:" + server.getAddress().getPort() + "/api")
                .maxRetries(2)
                .build();
        handler = exchange -> {
            exchange.getResponseHeaders().add("Retry-After", "600");
            respond(exchange, 429, "{}");
        };

        assertThatThrownBy(() -> retrying.getDocument("d-1"))
                .isInstanceOfSatisfying(AutosignlyException.RateLimit.class,
                        error -> assertThat(error.retryAfter()).isEqualTo(600));
        assertThat(calls).hasSize(1);
    }

    @Test
    void retriesAServerErrorAndReturnsTheEventualSuccess() {
        AutosignlyClient retrying = AutosignlyClient.builder("k", "s")
                .baseUrl("http://127.0.0.1:" + server.getAddress().getPort() + "/api")
                .maxRetries(2)
                .build();
        AtomicInteger call = new AtomicInteger();
        handler = exchange -> respond(exchange,
                call.getAndIncrement() == 0 ? 503 : 200,
                call.get() == 1 ? "{}" : "{\"id\":\"d-1\"}");

        assertThat(retrying.getDocument("d-1").id()).isEqualTo("d-1");
        assertThat(calls).hasSize(2);
    }

    @Test
    void setDocumentTagsReplacesTheWholeSet() {
        answer(200, "[{\"id\":\"t-1\",\"name\":\"CISO\"}]");

        var tags = client.setDocumentTags("d-1", null, List.of("CISO", "policy"));

        assertThat(calls.get(0).method()).isEqualTo("PUT");
        assertThat(calls.get(0).body()).contains("\"names\":[\"CISO\",\"policy\"]");
        assertThat(tags).singleElement().satisfies(tag -> assertThat(tag.name()).isEqualTo("CISO"));
    }

    @Test
    void reportsAnUnreachableApiAsAConnectionError() {
        AutosignlyClient unreachable = AutosignlyClient.builder("k", "s")
                .baseUrl("http://127.0.0.1:1/api")
                .maxRetries(0)
                .build();

        assertThatThrownBy(() -> unreachable.getDocument("d-1"))
                .isInstanceOf(AutosignlyException.Connection.class)
                .hasMessageContaining("Could not reach");
    }
}
