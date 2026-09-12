package com.cashflowcopilot.persona;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Public Persona webhook endpoint. Deliberately inert until signature verification exists:
 * accepting unverified webhooks would let anyone flip a user to approved.
 *
 * <p>TODO(persona): verify the {@code Persona-Signature} header with PERSONA_WEBHOOK_SECRET,
 * then resolve {@code reference-id} to the application user and apply
 * {@code inquiry.approved|declined|failed} to {@code app_users.persona_status}.
 */
@RestController
@RequestMapping("/webhooks/persona")
public class PersonaWebhookController {

    private static final Logger log = LoggerFactory.getLogger(PersonaWebhookController.class);

    @PostMapping
    public ResponseEntity<Void> receive() {
        log.warn("Persona webhook received but signature verification is not implemented; ignoring.");
        return ResponseEntity.status(HttpStatus.NOT_IMPLEMENTED).build();
    }
}
