package eu.autosignly;

import org.junit.jupiter.api.Test;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.HexFormat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class WebhooksTest {

    private static final String SECRET = "wh_secret";
    private static final byte[] BODY = "{\"eventType\":\"DOCUMENT_SIGNED\"}".getBytes(StandardCharsets.UTF_8);

    private static String now() {
        return String.valueOf(Instant.now().getEpochSecond());
    }

    /** Signs independently of the class under test, so a bug cannot cancel itself out. */
    private static String sign(String timestamp, String secret, byte[] body) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        mac.update((timestamp + ".").getBytes(StandardCharsets.UTF_8));
        return HexFormat.of().formatHex(mac.doFinal(body));
    }

    @Test
    void computeSignatureCoversTheTimestampAndTheBody() throws Exception {
        String timestamp = "1700000000";
        assertThat(Webhooks.computeSignature(BODY, SECRET, timestamp))
                .isEqualTo(sign(timestamp, SECRET, BODY));
    }

    @Test
    void acceptsADeliverySignedWithTheCurrentKey() throws Exception {
        String timestamp = now();
        assertThat(Webhooks.isValid(BODY, "v1=" + sign(timestamp, SECRET, BODY), SECRET, timestamp)).isTrue();
    }

    @Test
    void acceptsEitherSignatureWhileAKeyIsBeingRotated() throws Exception {
        String timestamp = now();
        String header = "v1=" + sign(timestamp, "wh_old", BODY) + ",v1=" + sign(timestamp, SECRET, BODY);

        assertThat(Webhooks.isValid(BODY, header, SECRET, timestamp)).isTrue();
        assertThat(Webhooks.isValid(BODY, header, "wh_old", timestamp)).isTrue();
    }

    @Test
    void rejectsABodyThatChangedByOneByte() throws Exception {
        String timestamp = now();
        byte[] tampered = "{\"eventType\":\"DOCUMENT_SIGNEE\"}".getBytes(StandardCharsets.UTF_8);

        assertThat(Webhooks.isValid(tampered, "v1=" + sign(timestamp, SECRET, BODY), SECRET, timestamp)).isFalse();
    }

    @Test
    void rejectsAWrongKey() throws Exception {
        String timestamp = now();
        assertThat(Webhooks.isValid(BODY, "v1=" + sign(timestamp, SECRET, BODY), "wh_other", timestamp)).isFalse();
    }

    @Test
    void rejectsAReplayedDeliveryOutsideTheTolerance() throws Exception {
        String old = String.valueOf(Instant.now().getEpochSecond() - 600);
        String header = "v1=" + sign(old, SECRET, BODY);

        assertThat(Webhooks.isValid(BODY, header, SECRET, old)).isFalse();
        assertThat(Webhooks.isValid(BODY, header, SECRET, old, 0)).isTrue();
    }

    @Test
    void rejectsAnUnknownSignatureVersion() throws Exception {
        String timestamp = now();
        assertThat(Webhooks.isValid(BODY, "v2=" + sign(timestamp, SECRET, BODY), SECRET, timestamp)).isFalse();
    }

    @Test
    void rejectsMissingInputInsteadOfThrowing() throws Exception {
        String timestamp = now();
        String header = "v1=" + sign(timestamp, SECRET, BODY);

        assertThat(Webhooks.isValid(BODY, "", SECRET, timestamp)).isFalse();
        assertThat(Webhooks.isValid(BODY, header, "", timestamp)).isFalse();
        assertThat(Webhooks.isValid(BODY, header, SECRET, "")).isFalse();
        assertThat(Webhooks.isValid(null, header, SECRET, timestamp)).isFalse();
    }

    @Test
    void verifyThrowsOnABadSignatureAndStaysQuietOnAGoodOne() throws Exception {
        String timestamp = now();

        assertThatThrownBy(() -> Webhooks.verify(BODY, "v1=deadbeef", SECRET, timestamp))
                .isInstanceOf(AutosignlyException.InvalidSignature.class);
        Webhooks.verify(BODY, "v1=" + sign(timestamp, SECRET, BODY), SECRET, timestamp);
    }
}
