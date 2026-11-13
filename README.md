# Astro Starter Kit: Basics

```sh
npm create astro@latest -- --template basics
```

> 🧑‍🚀 **Seasoned astronaut?** Delete this file. Have fun!

## 🚀 Project Structure

Inside of your Astro project, you'll see the following folders and files:

```text
/
├── public/
│   └── favicon.svg
├── src
│   ├── assets
│   │   └── astro.svg
│   ├── components
│   │   └── Welcome.astro
│   ├── layouts
│   │   └── Layout.astro
│   └── pages
│       └── index.astro
└── package.json
```

To learn more about the folder structure of an Astro project, refer to [our guide on project structure](https://docs.astro.build/en/basics/project-structure/).

## Note attachments

Before using note attachments, apply `migrations/note-attachments.sql` to the configured MySQL database after creating the existing `notes` table. Uploaded files are stored in the private `uploads/note-attachments/` directory and are served only to users who can access the associated note.

## Note pin and favorite preferences

Before using pinning or Favorites, apply `migrations/note-preferences.sql` to the configured MySQL database. Preferences are stored per signed-in user and note, including for notes shared with that user.

## Calendar and reminders

Before using the Calendar and Reminders pages, apply `migrations/reminders.sql` to the configured MySQL database after creating the existing `users` table. Reminder dates and times are stored in MySQL; theme preferences remain in browser storage. Due reminders are checked while the dashboard is open, and desktop notifications are optional.

## 🧞 Commands

All commands are run from the root of the project, from a terminal:

| Command                   | Action                                           |
| :------------------------ | :----------------------------------------------- |
| `npm install`             | Installs dependencies                            |
| `npm run dev`             | Starts local dev server at `localhost:4321`      |
| `npm run build`           | Build your production site to `./dist/`          |
| `npm run preview`         | Preview your build locally, before deploying     |
| `npm run astro ...`       | Run CLI commands like `astro add`, `astro check` |
| `npm run astro -- --help` | Get help using the Astro CLI                     |

## 👀 Want to learn more?

Feel free to check [our documentation](https://docs.astro.build) or jump into our [Discord server](https://astro.build/chat).
