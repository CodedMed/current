package com.cashflowcopilot.auth;

import com.cashflowcopilot.config.AppProperties;
import com.cashflowcopilot.error.ApiErrorResponse;
import com.cashflowcopilot.error.ErrorCode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Rejects internal API calls that do not carry the shared service token. Only the Next.js BFF
 * knows the token; the browser never sees it.
 *
 * <p>Hackathon-grade trust model. Production should use signed service-to-service tokens plus
 * network isolation.
 */
@Component
public class InternalServiceAuthFilter extends OncePerRequestFilter {

    public static final String INTERNAL_TOKEN_HEADER = "X-Internal-Service-Token";

    private final AppProperties properties;
    private final ObjectMapper objectMapper;

    public InternalServiceAuthFilter(AppProperties properties, ObjectMapper objectMapper) {
        this.properties = properties;
        this.objectMapper = objectMapper;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        String path = request.getRequestURI();
        // Persona posts the webhook directly and authenticates with its own signature.
        return !path.startsWith("/v1/");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        if (!tokenMatches(request.getHeader(INTERNAL_TOKEN_HEADER))) {
            writeUnauthenticated(response);
            return;
        }
        chain.doFilter(request, response);
    }

    private boolean tokenMatches(String presented) {
        if (presented == null) {
            return false;
        }
        return MessageDigest.isEqual(
                presented.getBytes(StandardCharsets.UTF_8),
                properties.internalServiceToken().getBytes(StandardCharsets.UTF_8));
    }

    private void writeUnauthenticated(HttpServletResponse response) throws IOException {
        response.setStatus(ErrorCode.UNAUTHENTICATED.status().value());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        objectMapper.writeValue(
                response.getOutputStream(),
                ApiErrorResponse.of(ErrorCode.UNAUTHENTICATED, "Missing or invalid internal service token."));
    }
}
