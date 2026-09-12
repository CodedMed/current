package com.cashflowcopilot.auth;

import com.cashflowcopilot.error.ApiException;
import com.cashflowcopilot.error.ErrorCode;
import com.cashflowcopilot.user.AppUser;
import com.cashflowcopilot.user.UserService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.core.MethodParameter;
import org.springframework.stereotype.Component;
import org.springframework.web.bind.support.WebDataBinderFactory;
import org.springframework.web.context.request.NativeWebRequest;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.method.support.ModelAndViewContainer;

@Component
public class CurrentUserResolver implements HandlerMethodArgumentResolver {

    public static final String AUTH_SUBJECT_HEADER = "X-Auth-Subject";

    private final UserService userService;
    private final PersonaAccessGuard personaAccessGuard;

    public CurrentUserResolver(UserService userService, PersonaAccessGuard personaAccessGuard) {
        this.userService = userService;
        this.personaAccessGuard = personaAccessGuard;
    }

    @Override
    public boolean supportsParameter(MethodParameter parameter) {
        return parameter.hasParameterAnnotation(CurrentUser.class)
                && AppUser.class.isAssignableFrom(parameter.getParameterType());
    }

    @Override
    public Object resolveArgument(
            MethodParameter parameter,
            ModelAndViewContainer mavContainer,
            NativeWebRequest webRequest,
            WebDataBinderFactory binderFactory) {

        HttpServletRequest request = webRequest.getNativeRequest(HttpServletRequest.class);
        String subject = request == null ? null : request.getHeader(AUTH_SUBJECT_HEADER);
        if (subject == null || subject.isBlank()) {
            throw new ApiException(ErrorCode.UNAUTHENTICATED, "Missing authenticated subject.");
        }

        AppUser user = userService.findOrCreateBySubject(subject);
        CurrentUser annotation = parameter.getParameterAnnotation(CurrentUser.class);
        if (annotation != null && annotation.requireVerified()) {
            personaAccessGuard.requireApproved(user);
        }
        return user;
    }
}
