---
layout: post
title: "Setting Up Local Instance of Tomcat (JSP)"
date: 2017-04-05
categories: databases jsp eclipse
---
# Pre-requisites

- Java 8 (JDK not required).

# Install Eclipse for Java EE developers

![Eclipse for Java EE](/assets/pictures/jsp-demo/java_ee.png)

Make sure to install Eclipse for Java EE developers even if you already have another version of Eclipse installed. This version includes many useful plugins for web development that are difficult to install correctly from the base version of Eclipse.

# Download and set up Tomcat

![Tomcat Download](/assets/pictures//jsp-demo/tomcat_download.png)

Go to [Tomcat's](https://tomcat.apache.org/) web page and download the latest version of Tomcat. Be sure to extract this zip file to a suitable location such as ProgramFiles on Windows since it must remain in one location to work with Eclipse.

# Create a new project

![Create project](/assets/pictures/jsp-demo/create_project.png)

Create a new project with the keyboard shortcut CTRL+n. Then, be sure to create a "Web/Dynamic Web" project NOT a regular Java project.

## Set up and select a new target runtime

![New runtime](/assets/pictures/jsp-demo/new_runtime.png)

After selecting to create a new project, click "Next". Select to create a new runtime which will allow you to configure Eclipse to use your downloaded version of Tomcat.

![Select Tomcat version](/assets/pictures/jsp-demo/select_8.0.png)

Select a matching version of Tomcat in the GUI.

![Create new local server](/assets/pictures/jsp-demo/new_local.png)

Select to create a new local server.

![Select installed Tomcat](/assets/pictures/jsp-demo/select_install.png)

Navigate to the unzipped directory of your Tomcat download and input that directory.

After creating the new runtime, select that new runtime as the target runtime and click "Finish" to create the project.

# Copy files into new project

![Copy HTML/JSP](/assets/pictures/jsp-demo/copy_html.png)

![Copy WEB-INF](/assets/pictures/jsp-demo/copy_webinf.png)

To utilize your existing work, copy your HTML and JSP files into /project/WebContent and copy the contents of WEB-INF into /project/WebContent/WEB-INF.

# Starting the web server

![Click run](/assets/pictures/jsp-demo/click_run.png)

![Select server to run](/assets/pictures/jsp-demo/use_server.png)

Just click run with an HTML/JSP file opened up from your new project. This will prompt you to select the server which you created. This should start up the web server on port 8080 and open up the web page in Eclipse (note that the URL will likely be prefixed with your project's name).