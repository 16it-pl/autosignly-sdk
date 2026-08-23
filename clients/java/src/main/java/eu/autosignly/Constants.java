package eu.autosignly;

/**
 * Values the API understands.
 *
 * <p>Plain strings rather than enums on purpose: the API may gain new values
 * over time, and a client that fails on an unknown value would break on a
 * server-side addition. These constants list what is known at release time.
 */
public final class Constants {

    private Constants() {}

    public static final class SignatureType {
        private SignatureType() {}
        /** Qualified — the strongest, backed by a qualified certificate. */
        public static final String QES = "QES";
        /** Advanced — identity verified by SMS or a bank login. */
        public static final String AES = "AES";
        /** Simple — the default. */
        public static final String SES = "SES";
    }

    public static final class VerificationMethod {
        private VerificationMethod() {}
        public static final String SMS = "SMS";
        /** Bank or national identity provider. */
        public static final String WK = "WK";
    }

    public static final class SignatureMode {
        private SignatureMode() {}
        /** The signer places a visual stamp on the document. */
        public static final String STAMP = "STAMP";
        /** Signatures are collected on a card appended to the document. */
        public static final String SIGNATURES_CARD = "SIGNATURES_CARD";
    }

    public static final class DocumentStatus {
        private DocumentStatus() {}
        public static final String GENERATED = "GENERATED";
        public static final String SIGNERS_ASSIGNED = "SIGNERS_ASSIGNED";
        public static final String WAITING_FOR_SIGNATURE = "WAITING_FOR_SIGNATURE";
        public static final String SIGNING_IN_PROGRESS = "SIGNING_IN_PROGRESS";
        /** Every signature is in and the closing seal has been applied. */
        public static final String SIGNED = "SIGNED";
        public static final String CANCELLED = "CANCELLED";
    }

    public static final class EnvironmentType {
        private EnvironmentType() {}
        public static final String PROD = "PROD";
        public static final String SANDBOX = "SANDBOX";
    }
}
