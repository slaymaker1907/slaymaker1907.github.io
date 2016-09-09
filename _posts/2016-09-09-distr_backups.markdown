---
layout: post
title: "Project Idea: Distributed Backups Using Desktop Machines"
date: 2016-09-09
categories: senior-project
---
# Introduction

Currently, backups of user data for businesses is firmly separated from user control by use of network drives. This introduces a lot of challenges from both a user and a management perspective since these network drives typically have worse performance than drives located physically on machines. Furthermore, network drives require separate hardware that must be redundantly stored both with RAID as well as in off site backups for maximum reliability. These resources must be managed separately from the desktop machines producing and consuming these resources providing network management overhead.

The idea proposed would be to utilize desktop machines within an organization to provide reliability and redundancy through a peer to peer network between these desktop machines providing eventual consistency among nodes to ensure availability and performance of the network.

# Architecture

The architecture would utilize standard P2P techniques (perhaps based off of BitTorrent) including a managing proxy to gain access to the backup network over a relatively low latency and high bandwidth WAN/LAN network typically found within businesses.

Redundancy would be provided by duplicating data across nodes managed either by the proxy or by some sort of distributed control board of nodes.

# Challenges

## Low Level Interactions

A key challenge with this project will be integrating closely with the target operating systems to interact with low level drivers and APIs to interact with being able to detect changes within the operating system and then determine how to replicate this data on the network.

## Network Management

Network management will be tricky to solve with this project given that it is adapting what is typically a very centralized system into a massively distributed system spread out over many business locations. While the proxy service which is used to gain access to the network could provide a majority of the management aspect of the software, it would probably be better if these functions could be run themselves off of the peer nodes where no single node controls the entire system.

Additionally, configuration of a system this complicated will pose a significant challenge to both be flexible enough to be useable as well as simple enough to not overwhelm administrators. One way to overcome this might be to utilize machine learning to do cumbersome tasks such as determining uncorrelated nodes to provide better redundancy as opposed to manual configuration as well as using machine learning to learn usage patterns to discover popular files on network drives and be able to place these files intelligently for performance.

## Security

This program will likely have to provide extensive authentication and authorization schemes, possibly integrating with existing systems, to secure both private user data as well as providing functionality of current network drives such as public and group folders over the network. This will be more challenging than with typical systems since data might be stored on an untrusted systems.
