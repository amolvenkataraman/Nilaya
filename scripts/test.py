import requests
import tkinter
from tkinter import messagebox

# Let's create the Tkinter window
window = tkinter.Tk()
window.title("GUI")
window.geometry(f"190x100+{int(window.winfo_screenwidth()/2 - 190/2)}+{int(window.winfo_screenheight()/2 - 100/2)}")

client = requests.session()
LOGIN_URL = 'http://127.0.0.1:8000/accounts/login/'

# You will create two text labels namely 'username' and 'password' and and two input labels for them

tkinter.Label(window, text="Username").grid(row = 0, pady=(10, 0)) #'username' is placed on position 00 (row - 0 and column - 0)

# 'Entry' class is used to display the input-field for 'username' text label
username = tkinter.StringVar()
tkinter.Entry(window, textvariable=username).grid(row = 0, column = 1, pady=(10, 0)) # first input-field is placed on position 01 (row - 0 and column - 1)

tkinter.Label(window, text="Password").grid(row = 1, pady=(0, 0)) #'password' is placed on position 10 (row - 1 and column - 0)

password = tkinter.StringVar()
tkinter.Entry(window, textvariable=password, show="*").grid(row = 1, column = 1, pady=(0, 0)) #second input-field is placed on position 11 (row - 1 and column - 1)

def login():
    global client
    global username
    global password

    if username.get() == '' or password.get() == '':
        messagebox.showerror(title='Invalid Credentials', message='Please enter a username and a password.')
        return

    # Retrieve the CSRF token first
    client.get(LOGIN_URL)  # sets cookie
    if 'csrftoken' in client.cookies:
        # Django 1.6 and up
        csrftoken = client.cookies['csrftoken']
    else:
        # older versions
        csrftoken = client.cookies['csrf']

    login_data = dict(username=username.get(), password=password.get(), csrfmiddlewaretoken=csrftoken, next='/')
    r = client.post(LOGIN_URL, data=login_data, headers=dict(Referer=LOGIN_URL))

    if "Please enter a correct username and password. Note that both fields are case-sensitive." in r.text:
        messagebox.showerror(title='Invalid Credentials', message='Invalid username and/or password.')
        return

    for widget in window.winfo_children():
        widget.destroy()

    window.geometry(f"500x500+{int(window.winfo_screenwidth()/2 - 500/2)}+{int(window.winfo_screenheight()/2 - 500/2)}")

# 'Checkbutton' class is for creating a checkbutton which will take a 'columnspan' of width two (covers two columns)
login_btn = tkinter.Button(window, text="Log In", command=login).grid(columnspan = 2, padx=(0, 0), pady=(10, 10))

window.mainloop()