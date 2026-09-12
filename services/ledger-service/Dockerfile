# Build context is the repository root: the migrations in db/migrations and the seed fixtures in
# samples/seed are compiled into the jar by the Maven resources configuration.
FROM maven:3.9-eclipse-temurin-17 AS build
WORKDIR /build
COPY services/ledger-service/pom.xml services/ledger-service/pom.xml
COPY services/ledger-service/.mvn services/ledger-service/.mvn
COPY services/ledger-service/mvnw services/ledger-service/mvnw
RUN cd services/ledger-service && mvn -B -q dependency:go-offline
COPY db db
COPY samples samples
COPY services/ledger-service/src services/ledger-service/src
RUN cd services/ledger-service && mvn -B -DskipTests package

FROM eclipse-temurin:17-jre
WORKDIR /app
COPY --from=build /build/services/ledger-service/target/ledger-service-*.jar app.jar
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
