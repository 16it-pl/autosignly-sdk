package eu.autosignly;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

/**
 * Data types returned by and passed to the Autosignly API.
 *
 * <p>Every response type ignores unknown properties, so a field added to the API
 * never breaks an integrator running an older client.
 */
public final class Models {

    private Models() {}

    /** A person asked to sign a document. */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record Signer(
            String firstName,
            String lastName,
            String email,
            /** ISO 3166-1 alpha-2, e.g. "PL". Decides the applicable signature policy. */
            String country,
            /** E.164, e.g. "+48123456789". Required for AES with SMS verification. */
            String phoneNumber,
            /** BCP 47 tag for the signing UI shown to this signer. */
            String locale,
            /** Signing order, starting at 1. Signers are notified one after another. */
            Integer order,
            String signatureType,
            String signatureVerificationMethod) {

        /** The four fields every signer needs. */
        public static Signer of(String firstName, String lastName, String email, String country) {
            return new Signer(firstName, lastName, email, country, null, null, null, null, null);
        }

        public Signer withOrder(int order) {
            return new Signer(firstName, lastName, email, country, phoneNumber, locale, order,
                    signatureType, signatureVerificationMethod);
        }

        public Signer withPhoneNumber(String phoneNumber) {
            return new Signer(firstName, lastName, email, country, phoneNumber, locale, order,
                    signatureType, signatureVerificationMethod);
        }

        public Signer withSignature(String signatureType, String verificationMethod) {
            return new Signer(firstName, lastName, email, country, phoneNumber, locale, order,
                    signatureType, verificationMethod);
        }
    }

    /** Which company and environment a key and secret pair resolves to. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Credentials(boolean valid, String companyId, String environmentId, String environmentType) {}

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Tag(String id, String name, String color) {}

    /** A signer as recorded on a document. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record SignerDetails(
            String email,
            String firstName,
            String lastName,
            String phoneNumber,
            String locale,
            String country,
            String signatureType,
            String signatureVerificationMethod,
            /** Position in the signing order, starting at 1. */
            Integer signingOrder) {}

    /**
     * Where a signer stands, and the link they were given.
     *
     * <p>Only the first signer still to sign carries {@code signUrl} — the next
     * person gets theirs once the previous one has signed.
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record SignerStatus(String email, String status, String signUrl, String expiresAt) {}

    /**
     * Full details of a document, including its signers and a link to its file.
     *
     * <p>{@code fileUrl} is short-lived. Fetch the document again for a fresh link
     * rather than storing it. A document still being signed can be downloaded as
     * well; it then carries only the signatures collected so far.
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Document(
            String id,
            String name,
            String companyId,
            String status,
            String signingMode,
            @JsonProperty("signerResponses") List<SignerDetails> signers,
            List<Tag> tags,
            String fileUrl) {

        public List<SignerDetails> signers() {
            return signers == null ? List.of() : signers;
        }

        public List<Tag> tags() {
            return tags == null ? List.of() : tags;
        }
    }

    /**
     * A file attached to a document.
     *
     * <p>Attachments are converted to PDF and merged into the document when it is
     * sent for signing, behind an index page listing each one with its checksum,
     * so a single signature covers the document and everything attached to it.
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Attachment(
            String id,
            int orderIndex,
            String fileName,
            String format,
            long sizeBytes,
            String sha256,
            Integer pageCount,
            String status,
            String fileUrl) {}

    /** A document as it appears in a list — no signers, no file link. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record DocumentSummary(
            String id,
            String name,
            String status,
            String signingMode,
            String createdAt,
            List<Tag> tags) {

        public List<Tag> tags() {
            return tags == null ? List.of() : tags;
        }
    }

    /** The outcome of sending an existing document for signature. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record SigningRequestResult(String documentId, String status, List<SignerStatus> signers) {

        public List<SignerStatus> signers() {
            return signers == null ? List.of() : signers;
        }
    }

    /** Counters describing a page of results. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record PageInfo(int number, int size, long totalElements, int totalPages) {}

    /** One page of a listing. */
    public record Page<T>(List<T> content, int number, int size, long totalElements, int totalPages) {

        public boolean hasNext() {
            return number + 1 < totalPages;
        }
    }
}
