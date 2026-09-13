package com.cashflowcopilot.todo;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import static org.assertj.core.api.Assertions.*;

@SpringBootTest(properties = {"app.demo-mode=true", "app.database-url=", "app.internal-service-token=todo-test"})
@AutoConfigureMockMvc
class TodoEditingTest {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;

    JsonNode read(String subject, MockHttpServletRequestBuilder request) throws Exception {
        return mapper.readTree(mvc.perform(request
                        .header("X-Internal-Service-Token", "todo-test")
                        .header("X-Auth-Subject", subject))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
    }

    String verifiedSubject() throws Exception {
        String subject = "todo-edit-" + UUID.randomUUID();
        read(subject, post("/v1/persona/status").contentType("application/json")
                .content("{\"status\":\"approved\"}"));
        return subject;
    }

    @Test void manualTasksDefaultToApprovedAndAdvisorTasksRemainProposals() throws Exception {
        String subject = verifiedSubject();
        JsonNode manual = read(subject, post("/v1/todos").contentType("application/json")
                .content("{\"title\":\"Call the supplier\"}"));
        assertThat(manual.get("source").asText()).isEqualTo("MANUAL");
        assertThat(manual.get("status").asText()).isEqualTo("APPROVED");
        JsonNode suggested = read(subject, post("/v1/todos").contentType("application/json")
                .content("{\"title\":\"Review payment terms\",\"source\":\"ADVISOR\"}"));
        assertThat(suggested.get("status").asText()).isEqualTo("PROPOSED");
    }

    @Test void editingOtherFieldsPreservesTheDateButAnExplicitNullClearsIt() throws Exception {
        String subject = verifiedSubject();
        JsonNode created = read(subject, post("/v1/todos").contentType("application/json")
                .content("{\"title\":\"Review invoice\",\"dueDate\":\"2026-10-01\"}"));
        String path = "/v1/todos/" + created.get("id").asText();
        JsonNode edited = read(subject, patch(path).contentType("application/json")
                .content("{\"title\":\"Review supplier invoice\",\"priority\":\"HIGH\"}"));
        assertThat(edited.get("dueDate").asText()).isEqualTo("2026-10-01");
        JsonNode cleared = read(subject, patch(path).contentType("application/json")
                .content("{\"dueDate\":null}"));
        assertThat(cleared.get("dueDate").isNull()).isTrue();
        JsonNode rescheduled = read(subject, patch(path).contentType("application/json")
                .content("{\"dueDate\":\"2026-11-01\"}"));
        assertThat(rescheduled.get("dueDate").asText()).isEqualTo("2026-11-01");
    }
}
