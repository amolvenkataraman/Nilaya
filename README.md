
# Comptech
My very own tech giant. (Recovered backup from April 2024 modified for running with the current server setup)

### WARNING: This is a half-decade old codebase carrying all the technical debt that high school me created. I strongly suggest NOT deploying this until I make my full rewrite (currently a work in progress). This repository is only to serve as a memory of my old code, and as a reference for the aforementioned full rewrite. This version is currently NOT STABLE ENOUGH FOR PRODUCTION.

## Features
- Calendar and todo-list app for time management.
- Photos app (like self-hosted Google Photos).

## Rules
1. **DO NOT** share the code, entirely or in part to **ANYONE** external or **ANY EXTERNAL WEBSITE/SERVICE** under **ANY CONDITION**. This is necessary to make sure that the code does not get leaked anywhere.
2. If you are using a CSS or JS library, **DO NOT** use the CDN links when committing or making a pull request. Download the file(s) to the `static_files/static` directory and use `{% static %}` URL's in the files.
3. If you are working on a feature that involves connecting to some other company's APIs or servers, please make sure you have my consent before implementing such code. Connecting to some servers is not allowed for secutity reasons.

## Installation Instructions
***DON'T EVEN TRY!*** This codebase is a complete mess as of now, and I intend to do a full rewrite when I get the time. This repository only serves as a backup and a reference until that happens. If, however, you are crazy and still want to run this version of the app, then **don't follow the instructions below**, I am keeping them as a memory of "the old days". **Please contact me for help** setting up or deploying.

1. Create an empty folder and run the command `git clone https://github.com/amolvenkataraman/Comptech_V1` to clone the repository to your computer. You will need to provide authentication.
2. Make sure you are in the root directory of the program (the directory with `manage.py`).
3. Install all the package dependencies by running the command `pip install -r requirements.txt`.
4. Run the commands `python manage.py makemigrations` and `python manage.py migrate` to set up the database.
5. Run the command `python manage.py createsuperuser` and follow the instructions to create an admin user.
6. Start the server by running the command `python manage.py runserver`.
7. Visit `127.0.0.1:8000` in your browser to view the website. Congratulations! 🎉 You have successfully set up Comptech on your computer.
8. Not so quick. When you try to visit the website, you might get an error. This is because there are no background images to display on the login page.
9. To fix this, login to the admin page by visiting `127.0.0.1:8000/admin` and log in with the credentials you entered in step 5. After logging in, click on *Bg_images* and click on the *ADD BG_IMAGE* button on the top right. Upload a large landscape image, fill in the textboxes and click *Save*. You will now have a background image when you visit the login page.
