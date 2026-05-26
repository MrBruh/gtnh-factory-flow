FROM azul/zulu-openjdk:17 AS jdk17
FROM eclipse-temurin:25-jdk-jammy AS jdk25

FROM eclipse-temurin:21-jdk-jammy

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    git \
    gnupg \
    libasound2 \
    libegl1 \
    libgl1 \
    libgl1-mesa-dri \
    libglx-mesa0 \
    libopenal1 \
    libx11-6 \
    libxcursor1 \
    libxext6 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxtst6 \
    libxxf86vm1 \
    mesa-utils \
    unzip \
    xauth \
    xvfb \
  && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
  && apt-get install -y --no-install-recommends nodejs \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace
COPY --from=jdk17 /usr/lib/jvm /opt/java/jvm17
COPY --from=jdk25 /opt/java/openjdk /opt/java/jdk-25
CMD ["bash"]
