---
layout: post
title: "Project Idea: Using Business Workstations for Cloud"
date: 2016-09-09
categories: senior-project
---
# Introduction

Businesses oftentimes have need for a secure cloud from which web services, batch processing jobs, etc. can be run from. Currently, the options in this space have been to either use a public, commercial cloud such as AWS or for a business to roll their own cloud in small to medium size data centers.

While both of these options have many of the benefits of cloud computing and are generally fairly easy for developers to use, they both come with significant downsides. A public cloud oftentimes incurs additional costs to a business versus running their own hardware and additionally can be a significant technical risk for a business to take, particularly for enterprises, due to serious issues of vendor lockins. AWS is successful now, but what about ten or twenty years from now? However, private data centers have an extremely high initial cost as well as having issues with being able to scale hardware as business increases.

Therefore, what we would do would be to adapt existing cloud technologies to use regular desktop workstations as a flexible cloud which will integrate as a separate program running on these desktop machines that can be adjusted to have more or less resources depending on the needs of the primary user of that desktop.

# Architecture

The architecture of this system will likely piggy back off of the existing open source cloud tool OpenStack. OpenStack is designed for companies to implement both private and public cloud with many features similar to AWS, Microsoft Azure, and Google Compute Platform such as virtual machine provisioning, metering and other types of monitoring, fast disk images for bringing up virtual machines quickly, a NoSQL datastore, etc.

However, while OpenStack is a good solution for companies to use with dedicated hardware, it does not seem to be designed to be run side by side with other programs on a typical desktop machine. The task of this project will be to add necessary functionality to be able to dynamically allocate and deallocate resources available to OpenStack on a given node depending on usage of that machine. For instance, OpenStack might be able to use all the resources of the machine during off hours when the employee is at home; however, during the workday the user may need all of the compute power during relatively intensive tasks such as video editing.

# Challenges

As highlighted earlier, a key challenge will be dynamically adjusting virtual machine instances depending on priority usage. This necessitates a highly dynamic compute network even more complex than typical solutions deployed on the cloud.

Security will also be an issue, though OpenStack provides fairly good security out of the box. One area of research, however, will be to investigate the ability for primary users not behind a hypervisor (virtual machine manager) to peek into the operations running on their computers. In a typical deployment, particularly for a private cloud, the base servers the cloud is running on can generally be trusted, but in this case that may not be true.

Designing applications to run in a cloud like this, while a challenge, is not infeasible. These applications simply need to be resilient enough to tolerate being brought down relatively quickly. One solution to make things slightly easier would be to allow for flexible deployments where certain critical services such as SQL databases run in a data center or in the public cloud while less critical applications such as web servers which are stateless and fault tolerant could run using this software. With that solution, though, there is the additional networking challenge in providing secure networks with this extremely heterogenous computing environment.

One final challenge is in figuring out how to predict usage of a particular desktop machine by priority users. While virtual machines can be brought up and down relatively quickly, there is still generally a relatively large delay in both actions on the order of dozens of seconds which may not be acceptable to end users. Machine learning might be one solution to monitor the host operating system to predict future load on the scale of the next several minutes.
