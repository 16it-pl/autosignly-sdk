package eu.autosignly;

/**
 * Base class for every error raised by this library.
 *
 * <p>Unchecked on purpose: an API call can fail in a dozen ways, and forcing a
 * {@code catch} at every call site produces noise rather than handling.
 */
public class AutosignlyException extends RuntimeException {

    private final Integer statusCode;
    private final String errorType;
    private final String errorId;

    public AutosignlyException(String message) {
        this(message, null, null, null, null);
    }

    public AutosignlyException(String message, Throwable cause) {
        this(message, null, null, null, cause);
    }

    public AutosignlyException(String message, Integer statusCode, String errorType, String errorId, Throwable cause) {
        super(message, cause);
        this.statusCode = statusCode;
        this.errorType = errorType;
        this.errorId = errorId;
    }

    /** HTTP status the API answered with, when the failure came from a response. */
    public Integer statusCode() {
        return statusCode;
    }

    /** Machine-readable cause from the API, for example {@code INVALID_REQUEST}. */
    public String errorType() {
        return errorType;
    }

    /** Correlation id — quote it when reporting a problem to support. */
    public String errorId() {
        return errorId;
    }

    @Override
    public String toString() {
        StringBuilder text = new StringBuilder(super.toString());
        if (errorType != null) {
            text.append(" type=").append(errorType);
        }
        if (errorId != null) {
            text.append(" errorId=").append(errorId);
        }
        return text.toString();
    }

    /** The API key or secret was rejected. */
    public static class Authentication extends AutosignlyException {
        public Authentication(String m, Integer s, String t, String i) { super(m, s, t, i, null); }
    }

    /** The credentials are valid but do not grant access to this resource. */
    public static class PermissionDenied extends AutosignlyException {
        public PermissionDenied(String m, Integer s, String t, String i) { super(m, s, t, i, null); }
    }

    /** The requested resource does not exist. */
    public static class NotFound extends AutosignlyException {
        public NotFound(String m, Integer s, String t, String i) { super(m, s, t, i, null); }
    }

    /** The request was rejected as invalid. */
    public static class Validation extends AutosignlyException {
        public Validation(String m, Integer s, String t, String i) { super(m, s, t, i, null); }
    }

    /** Too many requests were sent in a short period. */
    public static class RateLimit extends AutosignlyException {
        private final Double retryAfter;

        public RateLimit(String m, Integer s, String t, String i, Double retryAfter) {
            super(m, s, t, i, null);
            this.retryAfter = retryAfter;
        }

        /** Delay the API asked for, in seconds, when it provided one. */
        public Double retryAfter() { return retryAfter; }
    }

    /** The API failed to process the request. */
    public static class Server extends AutosignlyException {
        public Server(String m, Integer s, String t, String i) { super(m, s, t, i, null); }
    }

    /** The API could not be reached. */
    public static class Connection extends AutosignlyException {
        public Connection(String m, Throwable cause) { super(m, cause); }
    }

    /** A webhook signature did not match the payload. */
    public static class InvalidSignature extends AutosignlyException {
        public InvalidSignature(String m) { super(m); }
    }
}
