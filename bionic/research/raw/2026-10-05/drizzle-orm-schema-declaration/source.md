# Drizzle schema

Drizzle lets you define a schema in TypeScript with various models and properties supported by the underlying database. When you define your schema, it serves as the source of truth for future modifications in queries (using Drizzle-ORM) and migrations (using Drizzle-Kit).

If you are using Drizzle-Kit for the migration process, make sure to export all the models defined in your schema files so that Drizzle-Kit can import them and use them in the migration diff process.

Using imports

Using callback

Using import *
    
    
    import { integer, pgTable, varchar } from "drizzle-orm/pg-core";
    
    export const usersTable = pgTable("users", {
      id: integer().primaryKey().generatedAlwaysAsIdentity(),
      name: varchar().notNull(),
      age: integer().notNull(),
      email: varchar().notNull().unique(),
    });
    
    
    import { pgTable } from "drizzle-orm/pg-core";
    
    export const usersTable = pgTable("users", (t) => ({
      id: t.integer().primaryKey().generatedAlwaysAsIdentity(),
      name: t.varchar().notNull(),
      age: t.integer().notNull(),
      email: t.varchar().notNull().unique(),
    }));
    
    
    import * as p from "drizzle-orm/pg-core";
    
    export const usersTable = p.pgTable("users", {
      id: p.integer().primaryKey().generatedAlwaysAsIdentity(),
      name: p.varchar().notNull(),
      age: p.integer().notNull(),
      email: p.varchar().notNull().unique(),
    });

## Organize your schema files[](<https://orm.drizzle.team/docs/sql-schema-declaration#organize-your-schema-files>)

You can declare your SQL schema directly in TypeScript either in a single `schema.ts` file, or you can spread them around — whichever you prefer, all the freedom!

#### Schema in 1 file[](<https://orm.drizzle.team/docs/sql-schema-declaration#schema-in-1-file>)

The most common way to declare your schema with Drizzle is to put all your tables into one `schema.ts` file.

> Note: You can name your schema file whatever you like. For example, it could be `models.ts`, or something else.

This approach works well if you don’t have too many table models defined, or if you’re okay with keeping them all in one file

Example:
    
    
    📦 <project root>
     └ 📂 src
        └ 📂 db
           └ 📜 schema.ts

In the `drizzle.config.ts` file, you need to specify the path to your schema file. With this configuration, Drizzle will read from the `schema.ts` file and use this information during the migration generation process. For more information about the `drizzle.config.ts` file and migrations with Drizzle, please check: [link](<https://orm.drizzle.team/docs/drizzle-config-file>)
    
    
    import { defineConfig } from "drizzle-kit";
    
    export default defineConfig({
      dialect: 'postgresql',
      schema: './src/db/schema.ts'
    })

#### Schema in multiple files[](<https://orm.drizzle.team/docs/sql-schema-declaration#schema-in-multiple-files>)

You can place your Drizzle models — such as tables, enums, sequences, etc. — not only in one file but in any file you prefer. The only thing you must ensure is that you export all the models from those files so that the Drizzle kit can import them and use them in migrations.

One use case would be to separate each table into its own file.
    
    
    📦 <project root>
     └ 📂 src
        └ 📂 db
           └ 📂 schema
              ├ 📜 users.ts
              ├ 📜 countries.ts
              ├ 📜 cities.ts
              ├ 📜 products.ts
              ├ 📜 clients.ts
              └ 📜 etc.ts

In the `drizzle.config.ts` file, you need to specify the path to your schema folder. With this configuration, Drizzle will read from the `schema` folder and find all the files recursively and get all the drizzle tables from there. For more information about the `drizzle.config.ts` file and migrations with Drizzle, please check: [link](<https://orm.drizzle.team/docs/drizzle-config-file>)
    
    
    import { defineConfig } from "drizzle-kit";
    
    export default defineConfig({
      dialect: 'postgresql',
      schema: './src/db/schema'
    })

You can also group them in any way you like, such as creating groups for user-related tables, messaging-related tables, product-related tables, etc.
    
    
    📦 <project root>
     └ 📂 src
        └ 📂 db
           └ 📂 schema
              ├ 📜 users.ts
              ├ 📜 messaging.ts
              └ 📜 products.ts

## Shape your data schema[](<https://orm.drizzle.team/docs/sql-schema-declaration#shape-your-data-schema>)

Drizzle schema consists of several model types from database you are using. With drizzle you can specify:

  * Tables with columns, constraints, etc.
  * Schemas
  * Enums
  * Sequences
  * Views
  * Materialized Views
  * etc.

Let’s go one by one and check how the schema should be defined with drizzle

#### **Tables and columns declaration**[](<https://orm.drizzle.team/docs/sql-schema-declaration#tables-and-columns-declaration>)

A table in Drizzle should be defined with at least 1 column, the same as it should be done in database. There is one important thing to know, there is no such thing as a common table object in drizzle. You need to choose a dialect you are using, PostgreSQL, MySQL, SQLite, etc.

![](table-structure.fy17afPI_6Eq1p-bda02794.svg)
    
    
    import { pgTable, integer } from "drizzle-orm/pg-core"
    
    export const users = pgTable('users', {
      id: integer()
    });

By default, Drizzle will use the TypeScript key names for columns in database queries. Therefore, the schema and query from the example will generate the SQL query shown below

This example uses a db object, whose initialization is not covered in this part of the documentation. To learn how to connect to the database, please refer to the [Connections Docs](<https://orm.drizzle.team/docs/get-started-postgresql>)

  
**TypeScript key = database key**
    
    
    // schema.ts
    import { integer, pgTable, varchar } from "drizzle-orm/pg-core";
    
    export const users = pgTable('users', {
      id: integer(),
      first_name: varchar()
    })
    
    
    // query.ts
    await db.select().from(users);
    
    
    SELECT "id", "first_name" from users;

If you want to use different names in your TypeScript code and in the database, you can use column aliases
    
    
    // schema.ts
    import { integer, pgTable, varchar } from "drizzle-orm/pg-core";
    
    export const users = pgTable('users', {
      id: integer(),
      firstName: varchar('first_name')
    })
    
    
    // query.ts
    await db.select().from(users);
    
    
    SELECT "id", "first_name" from users;

### Camel and Snake casing[](<https://orm.drizzle.team/docs/sql-schema-declaration#camel-and-snake-casing>)

Database model names often use `snake_case` conventions, while in TypeScript, it is common to use `camelCase` for naming models. This can lead to a lot of alias definitions in the schema. To address this, Drizzle provides a way to automatically map `camelCase` from TypeScript to `snake_case` in the database via a dedicated builder.

Use the `snakeCase` or `camelCase` builder from `drizzle-orm/pg-core` to declare a table whose column keys are automatically mapped to the chosen database naming convention
    
    
    // schema.ts
    import { snakeCase, camelCase } from 'drizzle-orm/pg-core';
    
    export const users = snakeCase.table('users', {
      id: serial().primaryKey(),
      fullName: text(),        // → full_name in DB
      createdAt: timestamp(),  // → created_at in DB
    });
    
    // Available on all entity types:
    snakeCase.table / snakeCase.view / snakeCase.materializedView / snakeCase.schema
    camelCase.table / camelCase.view / camelCase.materializedView / camelCase.schema
    
    
    // db.ts
    import { drizzle } from "drizzle-orm/node-postgres";
    
    const db = drizzle({ connection: process.env.DATABASE_URL })
    
    
    // query.ts
    await db.select().from(users);
    
    
    select "id", "full_name", "created_at" from "users"

### Advanced[](<https://orm.drizzle.team/docs/sql-schema-declaration#advanced>)

There are a few tricks you can use with Drizzle ORM. As long as Drizzle is entirely in TypeScript files, you can essentially do anything you would in a simple TypeScript project with your code.

One common feature is to separate columns into different places and then reuse them. For example, consider the `updated_at`, `created_at`, and `deleted_at` columns. Many tables/models may need these three fields to track and analyze the creation, deletion, and updates of entities in a system

We can define those columns in a separate file and then import and spread them across all the table objects you have
    
    
    // columns.helpers.ts
    export const timestamps = {
      updated_at: timestamp(),
      created_at: timestamp().defaultNow().notNull(),
      deleted_at: timestamp(),
    }
    
    
    // users.sql.ts
    export const users = pgTable('users', {
      id: integer(),
      ...timestamps
    })
    
    
    // posts.sql.ts
    export const posts = pgTable('posts', {
      id: integer(),
      ...timestamps
    })

#### **Schemas**[](<https://orm.drizzle.team/docs/sql-schema-declaration#schemas>)

  
In PostgreSQL, there is an entity called a `schema` (which we believe should be called `folders`). This creates a structure in PostgreSQL:

![](postgresql-db-structure.BPKhPpto_2mAGNT-2cf78245.webp)

You can manage your PostgreSQL schemas with `pgSchema` and place any other models inside it.

Define the schema you want to manage using Drizzle
    
    
    import { pgSchema } from "drizzle-orm/pg-core"
    
    export const customSchema = pgSchema('custom');

Then place the table inside the schema object
    
    
    import { integer, pgSchema } from "drizzle-orm/pg-core";
    
    export const customSchema = pgSchema('custom');
    
    export const users = customSchema.table('users', {
      id: integer()
    })

### Example[](<https://orm.drizzle.team/docs/sql-schema-declaration#example>)

Once you know the basics, let’s define a schema example for a real project to get a better view and understanding

> All examples will use `generateUniqueString`. The implementation for it will be provided after all the schema examples
    
    
    import type { AnyPgColumn } from "drizzle-orm/pg-core";
    import { pgEnum, pgTable as table } from "drizzle-orm/pg-core";
    import * as t from "drizzle-orm/pg-core";
    
    export const rolesEnum = pgEnum("roles", ["guest", "user", "admin"]);
    
    export const users = table(
      "users",
      {
        id: t.integer().primaryKey().generatedAlwaysAsIdentity(),
        firstName: t.varchar("first_name", { length: 256 }),
        lastName: t.varchar("last_name", { length: 256 }),
        email: t.varchar().notNull(),
        invitee: t.integer().references((): AnyPgColumn => users.id),
        role: rolesEnum().default("guest"),
      },
      (table) => [
        t.uniqueIndex("email_idx").on(table.email)
      ]
    );
    
    export const posts = table(
      "posts",
      {
        id: t.integer().primaryKey().generatedAlwaysAsIdentity(),
        slug: t.varchar().$default(() => generateUniqueString(16)),
        title: t.varchar({ length: 256 }),
        ownerId: t.integer("owner_id").references(() => users.id),
      },
      (table) => [
        t.uniqueIndex("slug_idx").on(table.slug),
        t.index("title_idx").on(table.title),
      ]
    );
    
    export const comments = table("comments", {
      id: t.integer().primaryKey().generatedAlwaysAsIdentity(),
      text: t.varchar({ length: 256 }),
      postId: t.integer("post_id").references(() => posts.id),
      ownerId: t.integer("owner_id").references(() => users.id),
    });

**`generateUniqueString` implementation:**
    
    
    function generateUniqueString(length: number = 12): string {
      const characters =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
      let uniqueString = "";
    
      for (let i = 0; i < length; i++) {
        const randomIndex = Math.floor(Math.random() * characters.length);
        uniqueString += characters[randomIndex];
      }
    
      return uniqueString;
    }

#### What’s next?[](<https://orm.drizzle.team/docs/sql-schema-declaration#whats-next>)

  

**Manage schema**

[ Column types ](<https://orm.drizzle.team/docs/column-types>)[ Indexes and Constraints ](<https://orm.drizzle.team/docs/indexes-constraints>)[ Database Views ](<https://orm.drizzle.team/docs/views>)[ Database Schemas ](<https://orm.drizzle.team/docs/schemas>)[ Sequences ](<https://orm.drizzle.team/docs/sequences>)[ Extensions ](<https://orm.drizzle.team/docs/extensions>)

**Zero to Hero**

[ Database connection ](<https://orm.drizzle.team/docs/connect-overview>)[ Data querying ](<https://orm.drizzle.team/docs/data-querying>)[ Migrations ](<https://orm.drizzle.team/docs/migrations>)
