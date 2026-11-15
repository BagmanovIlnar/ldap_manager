# сборка: cargo build --release; рантайм: debian-slim + статика public/
FROM rust:1.100 AS build
WORKDIR /app
# кэш зависимостей: фиктивные исходники → cargo build → реальные исходники (touch заставит пересобрать крейт)
COPY Cargo.toml Cargo.lock ./
RUN mkdir src && echo "fn main(){}" > src/main.rs && echo "" > src/lib.rs && cargo build --release
COPY src ./src
RUN touch src/main.rs src/lib.rs && cargo build --release

FROM debian:bookworm-slim
RUN useradd -r app
COPY --from=build /app/target/release/ldap_manager /usr/local/bin/
COPY public /srv/public
ENV BIND_ADDR=0.0.0.0:8080 \
    PUBLIC_DIR=/srv/public
EXPOSE 8080
USER app
ENTRYPOINT ["/usr/local/bin/ldap_manager"]
