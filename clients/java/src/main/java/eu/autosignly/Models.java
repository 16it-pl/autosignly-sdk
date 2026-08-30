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

    /** Registered address of a party. */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record PartyAddress(
            String street,
            String number,
            String postalCode,
            String city,
            /** ISO 3166-1 alpha-2, e.g. "PL". A Polish address makes the tax id subject to the NIP checksum. */
            String countryCode) {}

    /**
     * A counterparty of the company — the other side of a document.
     *
     * <p>A COMPANY is identified by {@code taxId} and needs an {@code address}; a
     * PERSON needs a {@code firstname} and an {@code email}. Parties belong to the
     * environment of the key that created them, so a sandbox key never sees a
     * production party.
     *
     * <p>{@code id} and {@code createdAt} are filled in by the server and ignored
     * when the record is sent.
     */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Party(
            String type,
            String name,
            String firstname,
            String taxId,
            String email,
            String phone,
            PartyAddress address,
            String id,
            String createdAt) {

        /** A business, identified by its tax id. */
        public static Party company(String name, String taxId, String email, PartyAddress address) {
            return new Party(Constants.PartyType.COMPANY, name, null, taxId, email, null,
                    address, null, null);
        }

        /** A natural person, identified by a name and an e-mail. */
        public static Party person(String name, String firstname, String email) {
            return new Party(Constants.PartyType.PERSON, name, firstname, null, email, null,
                    null, null, null);
        }

        public Party withPhone(String phone) {
            return new Party(type, name, firstname, taxId, email, phone, address, id, createdAt);
        }

        public Party withAddress(PartyAddress address) {
            return new Party(type, name, firstname, taxId, email, phone, address, id, createdAt);
        }
    }

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

    /** One signature type a signer from a given country may be asked for. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record AllowedSignatureType(String type, List<String> verificationMethods) {

        /** Only for AES: how such a signer may confirm their identity. Empty for SES and QES. */
        public List<String> verificationMethods() {
            return verificationMethods == null ? List.of() : verificationMethods;
        }
    }

    /**
     * What may be asked of a signer from one country.
     *
     * <p>Sending a signer with a combination this policy does not list is rejected when
     * the document goes out, so read the policy before building your signer form.
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record SignaturePolicy(
            String country,
            boolean defaultPolicy,
            List<AllowedSignatureType> signatureTypes) {

        public List<AllowedSignatureType> signatureTypes() {
            return signatureTypes == null ? List.of() : signatureTypes;
        }
    }

    /** A country an SMS verification code can be delivered to. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record SmsCountry(String countryCode, String name, String dialingPrefix) {}

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
