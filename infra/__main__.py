"""A Python Pulumi program"""

import pulumi
import pulumi_docker as docker
import pulumi_docker_build as docker_build


# pulumi config set jan:profile cpu-fs
# pulumi config set jan:DOCKER_USR <>
# docker swarm init
#   docker swarm join --token SWMTKN-1-5resd3qhqi76nhli8et0hz8xtrnaahufkznvjuh154w1r87vme-chxankypx1c2ufizklhgsu3z2 192.168.65.3:2377
#   ___  ____  ____  ____  ____  _  _  ___  ___
#  / __)( ___)(_  _)(_  _)(_  _)( \( )/ __)/ __)
#  \__ \ )__)   )(    )(   _)(_  )  (( (_-.\__ \
#  (___/(____) (__)  (__) (____)(_)\_)\___/(___/

# generic variables
APP_FOLDER  = "../"
# Used for naming resources and tagging images
PREFIX = "jan_"

# available profiles
PROFILE_CPU_FS = "cpu-fs"
# Read configuration values for this stack
# pulumi config set profile linux
config = pulumi.Config()
profile = config.require("profile")
# Docker settings
DOCKER_ADDR = "docker.io"
DOCKER_USR = config.require("DOCKER_USR")
DOCKER_TAG = "latest"

#   ____  __  __    __    ___  ____  ___
#  (_  _)(  \/  )  /__\  / __)( ___)/ __)
#   _)(_  )    (  /(__)\( (_-. )__) \__ \
#  (____)(_/\/\_)(__)(__)\___/(____)(___/

# ###################################################################
# Common settings
BUILD_ON_PREVIEW=True
PUSH=True
EXEC=True

context=docker_build.BuildContextArgs(location=APP_FOLDER)
platforms=[ docker_build.Platform.LINUX_AMD64 ]
registries=[ docker_build.RegistryArgs(
    address=DOCKER_ADDR,
    password=config.require_secret("DOCKER_PAT"),
    username=DOCKER_USR,
)]

builder=docker_build.BuilderConfigArgs(name=config.get("DOCKER_BUILDER_NAME") | "default")


MINIO = "minio"

minio_registry_image = docker.get_registry_image(name="minio/minio")
minio_remote_image = docker.RemoteImage(PREFIX + MINIO,
    name=minio_registry_image.name,
    keep_locally=True,
    pull_triggers=[minio_registry_image.sha256_digest])


MC = "createbuckets"

mc_registry_image = docker.get_registry_image(name="minio/mc")
mc_remote_image = docker.RemoteImage(PREFIX + MC,
    name=mc_registry_image.name,
    keep_locally=True,
    pull_triggers=[mc_registry_image.sha256_digest])

APP = "app"

APP_TAG = DOCKER_ADDR + "/" + DOCKER_USR + "/" + \
    PREFIX + APP + "_" +profile + ":" + DOCKER_TAG
APP_DOCKERFILE = APP_FOLDER + "Dockerfile"

app_image = docker_build.Image(PREFIX + APP,
    tags=[APP_TAG],
    context=context,
    dockerfile=docker_build.DockerfileArgs(
        location=APP_DOCKERFILE,
    ),

    platforms=platforms,
    registries=registries,
    build_on_preview=BUILD_ON_PREVIEW,
    push=PUSH,
    # exec_=EXEC,
    # builder=builder,
)

#   _  _  ____  ____  _    _  _____  ____  _  _
#  ( \( )( ___)(_  _)( \/\/ )(  _  )(  _ \( )/ )
#   )  (  )__)   )(   )    (  )(_)(  )   / )  (
#  (_)\_)(____) (__) (__/\__)(_____)(_)\_)(_)\_)
# Define a Docker Network for continer comms"
network = docker.Network("vpcbr",
    name="vpcbr",
    # The bridge driver connects containers on a single host to
    # each other and to the host system
    driver="bridge",
    ipam_configs=[docker.NetworkIpamConfigArgs(
        subnet="10.5.0.0/16",
        gateway="10.5.0.1",
    )],
)

#   _  _  _____  __    __  __  __  __  ____
#  ( \/ )(  _  )(  )  (  )(  )(  \/  )( ___)
#   \  /  )(_)(  )(__  )(__)(  )    (  )__)
#    \/  (_____)(____)(______)(_/\/\_)(____)
# Volume details

volume_minio = docker.ContainerVolumeArgs(
    container_path="/data",host_path="/tmp/minio_data")

volume_app_data_cpu_fs = docker.ContainerVolumeArgs(
    container_path="/app/server/build/jan",host_path="/tmp/app_data_cpu_fs")

#   ____  _  _  _  _
#  ( ___)( \( )( \/ )
#   )__)  )  (  \  /
#  (____)(_)\_)  \/

container_env_app=["API_BASE_URL=http://localhost:1337"]
container_env_minio=[
    "MINIO_ROOT_USER=minioadmin",
    "MINIO_ROOT_PASSWORD=minioadmin"]


# #  Match the Docker Compose yaml file  for the services
# service_minio = docker.Service(
#     PREFIX + MINIO,
#     name=PREFIX + MINIO,
#     endpoint_spec=docker.ServiceEndpointSpecArgs(
#         ports=[docker.ServiceEndpointSpecPortArgs(
#             target_port=9000,
#             published_port=9000
#         ),
#         docker.ServiceEndpointSpecPortArgs(
#             target_port=9001,
#             published_port=9001
#     )]),
#     task_spec=docker.ServiceTaskSpecArgs(
#         restart_policy=docker.ServiceTaskSpecRestartPolicyArgs(
#             condition="any"
#         ),
#         networks_advanceds=[docker.ServiceTaskSpecNetworksAdvancedArgs(
#             name=network.name,
#             # ipv4_address="10.5.0.2"
#         )],
#         container_spec=docker.ServiceTaskSpecContainerSpecArgs(
#             image=minio_remote_image.repo_digest,
#             env={
#                 "MINIO_ROOT_USER":"minioadmin",
#                 "MINIO_ROOT_PASSWORD":"minioadmi"
#             },
#             commands=["server", "--console-address", ":9001", "/data"],
#             healthcheck=docker.ServiceTaskSpecContainerSpecHealthcheckArgs(
#                 tests=["CMD", "curl -f http://localhost:9000/minio/health/live"],
#                 interval="30s",
#                 timeout="20s",
#                 retries=3,
#             ),
#             mounts=[docker.ServiceTaskSpecContainerSpecMountArgs(
#                 target="/data",
#                 type="bind",
#                 source=volume_minio.host_path,
#             )],
#         ),
#     ),
# )


# #    ___  _____  _  _  ____   __    ____  _  _  ____  ____  ___
# #   / __)(  _  )( \( )(_  _) /__\  (_  _)( \( )( ___)(  _ \/ __)
# #  ( (__  )(_)(  )  (   )(  /(__)\  _)(_  )  (  )__)  )   /\__ \
# #   \___)(_____)(_)\_) (__)(__)(__)(____)(_)\_)(____)(_)\_)(___/
# container_minio = docker.Container(
#     PREFIX + MINIO,
#     name=PREFIX + MINIO,
#     image=minio_remote_image.repo_digest,
#     ports=[
#         docker.ContainerPortArgs(
#             internal=9000,
#             external=9000
#         ),
#         docker.ContainerPortArgs(
#             internal=9001,
#             external=9001
#         )
#     ],
#     restart="always",
#     envs=container_env_minio,
#     command=["server", "--console-address", ":9001", "/data"],
#     healthcheck=docker.ContainerHealthcheckArgs(
#         # tests=['CMD', 'curl', '-f', 'http://localhost:9000/minio/health/live'],
#         tests=["CMD-SHELL",
#                "wget --no-verbose --tries=1 --spider localhost:9000/minio/health/live || exit 1"],
#         interval="30s",
#         timeout="20s",
#         retries=3,
#     ),
#     networks_advanced=[docker.ContainerNetworksAdvancedArgs(
#         name=network.name,
#         ipv4_address="10.5.0.2")],
#     volumes=[volume_app_data_cpu_fs],
# )



# # container_mc = docker.Container(
# #     PREFIX + MC,
# #     name=PREFIX + MC,
# #     image=mc_remote_image.repo_digest,
# #     restart="no", # only run once
# #     entrypoints=[
# #         '''/bin/sh -c
# #         /usr/bin/mc alias set myminio http://minio:9000 minioadmin minioadmin; \
# #         /usr/bin/mc mb myminio/mybucket; 
# #         /usr/bin/mc policy set public myminio/mybucket;
# #         exit 0;'''
# #     ],
# #     networks_advanced=[docker.ContainerNetworksAdvancedArgs(
# #         name=network.name,
# #     )],
# #      opts=pulumi.ResourceOptions(depends_on=[
# #          mc_remote_image,
# #          container_minio]),
# # )

# container_app = docker.Container(
#     PREFIX + APP,
#     name=PREFIX + APP,
#     image=app_image.ref,
#     ports=[
#         docker.ContainerPortArgs(
#             internal=3000,
#             external=3000
#         ),
#         docker.ContainerPortArgs(
#             internal=1337,
#             external=1337
#         ),
#         docker.ContainerPortArgs(
#             internal=3928,
#             external=3928
#         )
#     ],
#     restart="always",
#     envs=container_env_app,
#     networks_advanced=[docker.ContainerNetworksAdvancedArgs(
#         name=network.name,
#         ipv4_address="10.5.0.5")],
#     volumes=[volume_app_data_cpu_fs],
# )
