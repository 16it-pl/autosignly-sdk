package eu.autosignly;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.HexFormat;

/**
 * Verifying webhook deliveries from Autosignly.
 *
 * <p>Every delivery carries {@code X-Webhook-Signature} and
 * {@code X-Webhook-Timestamp}. The signature is an HMAC-SHA256 over
 * {@code timestamp + "." + body}, keyed with the webhook key from the Autosignly
 * application, hex-encoded and prefixed with the signature version.
 */
public final class Webhooks {

    public static final String SIGNATURE_VERSION = "v1";

    /** Deliveries older than this are rejected, so a captured request cannot be replayed. */
    public static final long DEFAULT_TOLERANCE_SECONDS = 300;

    private Webhooks() {}

    /** Return the hex digest Autosignly sends for this payload and timestamp. */
    public static String computeSignature(byte[] payload, String secret, String timestamp) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            mac.update((timestamp + ".").getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(mac.doFinal(payload));
        } catch (Exception e) {
            throw new AutosignlyException("Could not compute the webhook signature", e);
        }
    }

    /**
     * Check a delivery without throwing.
     *
     * <p>{@code payload} must be the raw request body exactly as received.
     * Parsing and re-serialising the JSON changes the bytes and invalidates the
     * signature — read the body as {@code byte[]} before any framework binds it
     * to an object.
     *
     * <p>The header may carry several signatures separated by commas: during a
     * key rotation Autosignly signs with both the new and the previous key, so a
     * delivery stays verifiable while you swap your stored secret.
     */
    public static boolean isValid(byte[] payload, String signatureHeader, String secret, String timestamp) {
        return isValid(payload, signatureHeader, secret, timestamp, DEFAULT_TOLERANCE_SECONDS);
    }

    /** As {@link #isValid(byte[], String, String, String)}, with 0 tolerance skipping the freshness check. */
    public static boolean isValid(byte[] payload, String signatureHeader, String secret,
                                  String timestamp, long toleranceSeconds) {
        if (payload == null || isBlank(signatureHeader) || isBlank(secret) || isBlank(timestamp)) {
            return false;
        }
        if (toleranceSeconds > 0 && !isFresh(timestamp, toleranceSeconds)) {
            return false;
        }

        String expected = computeSignature(payload, secret, timestamp);
        for (String candidate : signatureHeader.split(",")) {
            int separator = candidate.indexOf('=');
            if (separator < 0) {
                continue;
            }
            String version = candidate.substring(0, separator).trim();
            String digest = candidate.substring(separator + 1).trim();
            if (SIGNATURE_VERSION.equals(version) && equalsConstantTime(digest, expected)) {
                return true;
            }
        }
        return false;
    }

    /** Check a delivery and throw {@link AutosignlyException.InvalidSignature} if it fails. */
    public static void verify(byte[] payload, String signatureHeader, String secret, String timestamp) {
        if (!isValid(payload, signatureHeader, secret, timestamp)) {
            throw new AutosignlyException.InvalidSignature("Webhook signature does not match the payload");
        }
    }

    private static boolean equalsConstantTime(String received, String expected) {
        return MessageDigest.isEqual(
                received.getBytes(StandardCharsets.UTF_8),
                expected.getBytes(StandardCharsets.UTF_8));
    }

    private static boolean isFresh(String timestamp, long toleranceSeconds) {
        try {
            long sent = Long.parseLong(timestamp.trim());
            return Math.abs(Instant.now().getEpochSecond() - sent) <= toleranceSeconds;
        } catch (NumberFormatException e) {
            return false;
        }
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }
}
