package eu.autosignly;

import com.fasterxml.jackson.annotation.JsonProperty;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.yaml.snakeyaml.Yaml;

import java.io.IOException;
import java.lang.reflect.RecordComponent;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Contract test: every field name this client reads or sends must exist in the
 * published OpenAPI schema.
 *
 * <p>The field lists are not written by hand — they come from the record
 * components through reflection, so a model that gains or renames a field is
 * checked automatically, which a hand-kept list would never do.
 *
 * <p>Runs offline against {@code spec/autodocuments-v1.yaml}: no environment,
 * no network.
 */
class ContractTest {

    private static final Map<String, Object> SPEC = loadSpec();

    @SuppressWarnings("unchecked")
    private static Map<String, Object> loadSpec() {
        Path spec = Path.of("..", "..", "spec", "autodocuments-v1.yaml").toAbsolutePath().normalize();
        try {
            return (Map<String, Object>) new Yaml().load(Files.readString(spec));
        } catch (IOException e) {
            throw new IllegalStateException("Cannot read the API spec at " + spec, e);
        }
    }

    @SuppressWarnings("unchecked")
    private static Set<String> propertiesOf(String schema) {
        Map<String, Object> schemas =
                (Map<String, Object>) ((Map<String, Object>) SPEC.get("components")).get("schemas");
        Map<String, Object> found = (Map<String, Object>) schemas.get(schema);
        assertThat(found).as("schema %s is missing from the spec", schema).isNotNull();
        Map<String, Object> properties = (Map<String, Object>) found.get("properties");
        return properties == null ? Set.of() : new LinkedHashSet<>(properties.keySet());
    }

    /**
     * The wire names a record maps to, honouring an explicit {@code @JsonProperty}.
     *
     * <p>The annotation has to be looked up on the field and the accessor as well
     * as the component: {@code @JsonProperty} does not target record components,
     * so the compiler propagates it to the field, which is where Jackson reads it
     * from and where a naive reflection helper would miss it.
     */
    private static Set<String> wireNamesOf(Class<?> type) {
        Set<String> names = new LinkedHashSet<>();
        for (RecordComponent component : type.getRecordComponents()) {
            names.add(jsonNameOf(type, component));
        }
        return names;
    }

    private static String jsonNameOf(Class<?> type, RecordComponent component) {
        JsonProperty onComponent = component.getAnnotation(JsonProperty.class);
        if (onComponent != null) {
            return onComponent.value();
        }
        try {
            JsonProperty onField = type.getDeclaredField(component.getName()).getAnnotation(JsonProperty.class);
            if (onField != null) {
                return onField.value();
            }
        } catch (NoSuchFieldException ignored) {
            // A record always has the backing field; nothing to do if it is absent.
        }
        JsonProperty onAccessor = component.getAccessor().getAnnotation(JsonProperty.class);
        return onAccessor != null ? onAccessor.value() : component.getName();
    }

    static Stream<org.junit.jupiter.params.provider.Arguments> models() {
        return Stream.of(
                org.junit.jupiter.params.provider.Arguments.of(Models.Document.class, "DocumentInfoResponse"),
                org.junit.jupiter.params.provider.Arguments.of(Models.DocumentSummary.class, "DocumentListItemResponse"),
                org.junit.jupiter.params.provider.Arguments.of(Models.SignerDetails.class, "SignerResponse"),
                org.junit.jupiter.params.provider.Arguments.of(Models.SignerStatus.class, "SignerStatusResponse"),
                org.junit.jupiter.params.provider.Arguments.of(Models.Credentials.class, "CredentialsResponse"),
                org.junit.jupiter.params.provider.Arguments.of(Models.SigningRequestResult.class, "SendForSigningResponse"),
                org.junit.jupiter.params.provider.Arguments.of(Models.Tag.class, "TagResponse1"),
                org.junit.jupiter.params.provider.Arguments.of(Models.PageInfo.class, "PageInfo"),
                org.junit.jupiter.params.provider.Arguments.of(Models.Signer.class, "ExternalSignerRequest"));
    }

    @ParameterizedTest(name = "{0} matches {1}")
    @MethodSource("models")
    void modelOnlyUsesFieldsDeclaredInTheSchema(Class<?> model, String schema) {
        Set<String> declared = propertiesOf(schema);
        List<String> unknown = new ArrayList<>(wireNamesOf(model));
        unknown.removeAll(declared);

        assertThat(unknown)
                .as("%s uses fields the API does not know: %s", model.getSimpleName(), unknown)
                .isEmpty();
    }

    @Test
    void everyEndpointTheClientCallsExists() {
        @SuppressWarnings("unchecked")
        Set<String> paths = ((Map<String, Object>) SPEC.get("paths")).keySet();

        List<String> called = Arrays.asList(
                "/api/publics/v1/api-key",
                "/api/publics/v1/credentials",
                "/api/publics/v1/documents",
                "/api/publics/v1/documents/{documentId}",
                "/api/publics/v1/documents/signings",
                "/api/publics/v1/documents/{documentId}/send-for-signing",
                "/api/publics/v1/documents/{documentId}/tags",
                "/api/publics/v1/tags",
                "/api/publics/v1/tags/{tagId}");

        List<String> missing = new ArrayList<>(called);
        missing.removeAll(paths);

        assertThat(missing).as("endpoints gone from the API: %s", missing).isEmpty();
    }

    @Test
    void theSigningRequestSendsOnlyFieldsTheApiAccepts() {
        Set<String> declared = propertiesOf("UploadPdfAndSignRequest");

        // Built the same way the client builds it, so the assertion covers the
        // real request rather than a restatement of it.
        var body = AutosignlyClient.SigningOptions
                .of(List.of(Models.Signer.of("A", "B", "a@b.test", "PL")))
                .withSignature("SES", "SIGNATURES_CARD")
                .withVerificationMethod("SMS")
                .withInitiator("initiator@example.com", "pl")
                .toJson(new com.fasterxml.jackson.databind.ObjectMapper());
        body.put("documentName", "Umowa");

        List<String> unknown = new ArrayList<>();
        body.fieldNames().forEachRemaining(name -> {
            if (!declared.contains(name)) {
                unknown.add(name);
            }
        });

        assertThat(unknown).as("unknown request fields: %s", unknown).isEmpty();
        assertThat(propertiesOf("SigningInitiatorData")).contains("email", "locale");
    }
}
