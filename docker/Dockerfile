FROM ubuntu:22.04

# default shell
SHELL ["/bin/bash", "-c"]

# base deps
RUN apt-get update \
      && apt-get install -y python3 python3-pip make g++ build-essential wget curl ca-certificates git vim\
      && rm -rf /var/lib/apt/lists/*

# nvm & nodejs
RUN curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
RUN source /root/.nvm/nvm.sh \
      && nvm install 22 \
      && npm install -g npm@latest

# vyper
RUN pip3 install vyper==0.2.8

# pnpm
RUN npm install -g pnpm

# yarn
RUN npm install -g yarn

# foundry
RUN curl -L https://foundry.paradigm.xyz | bash
RUN /root/.foundry/bin/foundryup --install nightly

WORKDIR /workspace
