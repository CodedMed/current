package com.cashflowcopilot.auth;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Resolves the caller identity forwarded by the BFF in {@code X-Auth-Subject} into an
 * {@code AppUser}. Persona approval is enforced unless the endpoint opts out.
 */
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.PARAMETER)
public @interface CurrentUser {

    boolean requireVerified() default true;
}
