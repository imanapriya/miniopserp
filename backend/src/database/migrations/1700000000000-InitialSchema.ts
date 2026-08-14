import { MigrationInterface, QueryRunner } from "typeorm";

export class InitialSchema1700000000000 implements MigrationInterface {
    name = 'InitialSchema1700000000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // uuid_generate_v4() lives in this extension. Creating it here (rather
        // than assuming a DBA already did) is what lets `npm run migration:run`
        // bootstrap a brand new, empty database on any PostgreSQL provider.
        await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
        await queryRunner.query(`CREATE TABLE "locations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "code" character varying(32) NOT NULL, "name" character varying(120) NOT NULL, "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_1c65ef243169e51b514c814eeae" UNIQUE ("code"), CONSTRAINT "PK_7cc1c9e3853b94816c094825e74" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "categories" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "code" character varying(32) NOT NULL, "name" character varying(120) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_77d7eff8a7aaa05457a12b8007a" UNIQUE ("code"), CONSTRAINT "PK_24dbc6126a28ff948da33e97d3b" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "items" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "sku" character varying(64) NOT NULL, "name" character varying(160) NOT NULL, "uom" character varying(16) NOT NULL DEFAULT 'EA', "category_id" uuid NOT NULL, "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_ed4485e4da7cc242cf46db2e3a9" UNIQUE ("sku"), CONSTRAINT "PK_ba5885359424c15ca6b9e79bcf6" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_0c4aa809ddf5b0c6ca45d8a8e8" ON "items"  ("category_id") `);
        await queryRunner.query(`CREATE TABLE "batches" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "code" character varying(64) NOT NULL, "item_id" uuid NOT NULL, "expiry_date" date, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_batch_item_code" UNIQUE ("item_id", "code"), CONSTRAINT "PK_55e7ff646e969b61d37eea5be7a" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_4189d6a832feca8867fdda65e5" ON "batches"  ("expiry_date") `);
        await queryRunner.query(`CREATE TYPE "public"."user_role" AS ENUM('ADMIN', 'OPERATIONS', 'SALES')`);
        await queryRunner.query(`CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "email" character varying(160) NOT NULL, "name" character varying(120) NOT NULL, "password_hash" character varying(120) NOT NULL, "role" "public"."user_role" NOT NULL, "is_active" boolean NOT NULL DEFAULT true, "location_id" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_ace513fa30d485cfd25c11a9e4" ON "users"  ("role") `);
        await queryRunner.query(`INSERT INTO "typeorm_metadata"("database", "schema", "table", "type", "name", "value") VALUES ($1, $2, $3, $4, $5, $6)`, ["ops_erp","public","inventory","GENERATED_COLUMN","available_qty","\"physical_qty\" - \"reserved_qty\""]);
        await queryRunner.query(`CREATE TABLE "inventory" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "item_id" uuid NOT NULL, "location_id" uuid NOT NULL, "batch_id" uuid NOT NULL, "physical_qty" integer NOT NULL DEFAULT '0', "reserved_qty" integer NOT NULL DEFAULT '0', "available_qty" integer GENERATED ALWAYS AS ("physical_qty" - "reserved_qty") STORED NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_inventory_item_location_batch" UNIQUE ("item_id", "location_id", "batch_id"), CONSTRAINT "CHK_inventory_reserved_lte_physical" CHECK ("reserved_qty" <= "physical_qty"), CONSTRAINT "CHK_inventory_reserved_non_negative" CHECK ("reserved_qty" >= 0), CONSTRAINT "CHK_inventory_physical_non_negative" CHECK ("physical_qty" >= 0), CONSTRAINT "PK_82aa5da437c5bbfb80703b08309" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_a4a62e5d0870b0e0476bc5e3bb" ON "inventory"  ("location_id", "item_id") `);
        await queryRunner.query(`CREATE TYPE "public"."inventory_txn_type" AS ENUM('RECEIPT', 'ISSUE', 'ADJUSTMENT', 'RESERVE', 'RELEASE', 'CONSUME', 'TRANSFER_OUT', 'TRANSFER_IN')`);
        await queryRunner.query(`CREATE TABLE "inventory_transactions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "inventory_id" uuid NOT NULL, "type" "public"."inventory_txn_type" NOT NULL, "physical_delta" integer NOT NULL DEFAULT '0', "reserved_delta" integer NOT NULL DEFAULT '0', "ref_type" character varying(32), "ref_id" uuid, "note" character varying(255), "idempotency_key" character varying(160), "created_by_id" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_8e3e9e7a9aff49e26f396568782" UNIQUE ("idempotency_key"), CONSTRAINT "PK_9b7144851f08f9eededde7edd42" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_a5de1b60af896c157a4bcc13d9" ON "inventory_transactions"  ("ref_type", "ref_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_8f3fd4c00e5434b1791e7262ad" ON "inventory_transactions"  ("inventory_id", "created_at") `);
        await queryRunner.query(`CREATE TYPE "public"."work_order_status" AS ENUM('ASSIGNED', 'IN_PROGRESS', 'COMPLETED')`);
        await queryRunner.query(`CREATE TABLE "work_orders" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "code" character varying(32) NOT NULL, "location_id" uuid NOT NULL, "item_id" uuid NOT NULL, "required_qty" integer NOT NULL, "assigned_to_id" uuid NOT NULL, "status" "public"."work_order_status" NOT NULL DEFAULT 'ASSIGNED', "notes" character varying(500), "created_by_id" uuid NOT NULL, "started_at" TIMESTAMP WITH TIME ZONE, "completed_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_ca7b6602b744e246946406bd49a" UNIQUE ("code"), CONSTRAINT "CHK_work_order_qty_positive" CHECK ("required_qty" > 0), CONSTRAINT "PK_29f6c1884082ee6f535aed93660" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_04b61ed40717e3c95f7514f57b" ON "work_orders"  ("location_id", "item_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_84a22e7f4761f9b56f06b48cd6" ON "work_orders"  ("status") `);
        await queryRunner.query(`CREATE TYPE "public"."transfer_status" AS ENUM('REQUESTED', 'DISPATCHED', 'RECEIVED')`);
        await queryRunner.query(`CREATE TABLE "stock_transfers" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "code" character varying(32) NOT NULL, "source_location_id" uuid NOT NULL, "destination_location_id" uuid NOT NULL, "item_id" uuid NOT NULL, "batch_id" uuid NOT NULL, "quantity" integer NOT NULL, "received_qty" integer NOT NULL DEFAULT '0', "status" "public"."transfer_status" NOT NULL DEFAULT 'REQUESTED', "work_order_id" uuid, "created_by_id" uuid NOT NULL, "dispatched_at" TIMESTAMP WITH TIME ZONE, "received_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_15a2ea420f6c237451087244de8" UNIQUE ("code"), CONSTRAINT "CHK_transfer_distinct_locations" CHECK ("source_location_id" <> "destination_location_id"), CONSTRAINT "CHK_transfer_received_qty_range" CHECK ("received_qty" >= 0 AND "received_qty" <= "quantity"), CONSTRAINT "CHK_transfer_qty_positive" CHECK ("quantity" > 0), CONSTRAINT "PK_ef738a3a4a578c7f1802c1bb50a" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_281ba00f4344fb4b1a958245d8" ON "stock_transfers"  ("destination_location_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_cee3608ef194fa0a22ce9f6377" ON "stock_transfers"  ("source_location_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_84004eeaa39e7346921c319d96" ON "stock_transfers"  ("status") `);
        await queryRunner.query(`CREATE TABLE "customer_order_lines" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "order_id" uuid NOT NULL, "item_id" uuid NOT NULL, "location_id" uuid NOT NULL, "quantity" integer NOT NULL, "reserved_qty" integer NOT NULL DEFAULT '0', CONSTRAINT "CHK_order_line_reserved_range" CHECK ("reserved_qty" >= 0 AND "reserved_qty" <= "quantity"), CONSTRAINT "CHK_order_line_qty_positive" CHECK ("quantity" > 0), CONSTRAINT "PK_a57a302af0cd2204f16ad2c0505" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_87cb0be8f629c35df0469d3980" ON "customer_order_lines"  ("order_id") `);
        await queryRunner.query(`CREATE TYPE "public"."order_status" AS ENUM('DRAFT', 'RESERVED', 'FULFILLED', 'CANCELLED')`);
        await queryRunner.query(`CREATE TABLE "customer_orders" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "code" character varying(32) NOT NULL, "customer_name" character varying(160) NOT NULL, "status" "public"."order_status" NOT NULL DEFAULT 'DRAFT', "created_by_id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_f1ca70b7e622c532eeeaec0cb4d" UNIQUE ("code"), CONSTRAINT "PK_ce425b6edb31cce9a80b269298e" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_ea748d97d9c3e0d5f9c1bf7ffc" ON "customer_orders"  ("status") `);
        await queryRunner.query(`CREATE TYPE "public"."reservation_status" AS ENUM('ACTIVE', 'RELEASED', 'CONSUMED')`);
        await queryRunner.query(`CREATE TABLE "reservations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "order_line_id" uuid NOT NULL, "inventory_id" uuid NOT NULL, "quantity" integer NOT NULL, "status" "public"."reservation_status" NOT NULL DEFAULT 'ACTIVE', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "released_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "CHK_reservation_qty_positive" CHECK ("quantity" > 0), CONSTRAINT "PK_da95cef71b617ac35dc5bcda243" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_d4c7b2d2cefc1eaecc6b98847a" ON "reservations"  ("inventory_id", "status") `);
        await queryRunner.query(`CREATE INDEX "IDX_184589c0332faa113faeb95434" ON "reservations"  ("order_line_id") `);
        await queryRunner.query(`ALTER TABLE "items" ADD CONSTRAINT "FK_0c4aa809ddf5b0c6ca45d8a8e80" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "batches" ADD CONSTRAINT "FK_d5ce6c9463b9c91de64e1898b05" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "users" ADD CONSTRAINT "FK_1523fb2aebce55b9e820122ee0e" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "inventory" ADD CONSTRAINT "FK_94f5cbcb5f280f2f30bd4a9fd90" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "inventory" ADD CONSTRAINT "FK_1eea99c8c645d7541002473a015" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "inventory" ADD CONSTRAINT "FK_3883f580f1a93c37dba76d42f75" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "inventory_transactions" ADD CONSTRAINT "FK_f0ece5f39fcf22fcbe0c69e0c1d" FOREIGN KEY ("inventory_id") REFERENCES "inventory"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "inventory_transactions" ADD CONSTRAINT "FK_d320a3777b000fa88357a063d7d" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "work_orders" ADD CONSTRAINT "FK_15026f4fdebfcd58e9976034046" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "work_orders" ADD CONSTRAINT "FK_ba9233bf837be1df36d25e3a939" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "work_orders" ADD CONSTRAINT "FK_791ae6a4a4f03205d47270e0c62" FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "work_orders" ADD CONSTRAINT "FK_892244c7e30eda7d2406dda545b" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "stock_transfers" ADD CONSTRAINT "FK_cee3608ef194fa0a22ce9f6377e" FOREIGN KEY ("source_location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "stock_transfers" ADD CONSTRAINT "FK_281ba00f4344fb4b1a958245d85" FOREIGN KEY ("destination_location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "stock_transfers" ADD CONSTRAINT "FK_294576631d11e1ae8fec5526386" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "stock_transfers" ADD CONSTRAINT "FK_cd9f1ba0e78a9836d6b8e166a23" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "stock_transfers" ADD CONSTRAINT "FK_efe11b31d123f1c1cee35af9a9c" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "stock_transfers" ADD CONSTRAINT "FK_de39ccb2a7a4ecb7610dc284a0b" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "customer_order_lines" ADD CONSTRAINT "FK_87cb0be8f629c35df0469d3980e" FOREIGN KEY ("order_id") REFERENCES "customer_orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "customer_order_lines" ADD CONSTRAINT "FK_a08b14bac982377345c9cd3f141" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "customer_order_lines" ADD CONSTRAINT "FK_a3c9142e9d930e75038f81ea9dc" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "customer_orders" ADD CONSTRAINT "FK_a1d00b28e20537c6cbe95da0983" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "reservations" ADD CONSTRAINT "FK_184589c0332faa113faeb954341" FOREIGN KEY ("order_line_id") REFERENCES "customer_order_lines"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "reservations" ADD CONSTRAINT "FK_ecb90f6be7269b65f95303cb3cf" FOREIGN KEY ("inventory_id") REFERENCES "inventory"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);

        // ------------------------------------------------------------------
        // Reporting view.
        //
        // Flattens the inventory buckets with their master data so operations
        // screens and ad-hoc SQL do not have to repeat the four-way join, and
        // so `available_qty` is readable straight from the database.
        // ------------------------------------------------------------------
        await queryRunner.query(`
            CREATE VIEW "v_inventory_available" AS
            SELECT
                inv."id"            AS inventory_id,
                loc."code"          AS location_code,
                loc."name"          AS location_name,
                it."sku"            AS sku,
                it."name"           AS item_name,
                cat."name"          AS category_name,
                b."code"            AS batch_code,
                b."expiry_date"     AS expiry_date,
                inv."physical_qty"  AS physical_qty,
                inv."reserved_qty"  AS reserved_qty,
                inv."available_qty" AS available_qty
            FROM "inventory" inv
            JOIN "locations"  loc ON loc."id" = inv."location_id"
            JOIN "items"      it  ON it."id"  = inv."item_id"
            JOIN "categories" cat ON cat."id" = it."category_id"
            JOIN "batches"    b   ON b."id"   = inv."batch_id"
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP VIEW IF EXISTS "v_inventory_available"`);
        await queryRunner.query(`ALTER TABLE "reservations" DROP CONSTRAINT "FK_ecb90f6be7269b65f95303cb3cf"`);
        await queryRunner.query(`ALTER TABLE "reservations" DROP CONSTRAINT "FK_184589c0332faa113faeb954341"`);
        await queryRunner.query(`ALTER TABLE "customer_orders" DROP CONSTRAINT "FK_a1d00b28e20537c6cbe95da0983"`);
        await queryRunner.query(`ALTER TABLE "customer_order_lines" DROP CONSTRAINT "FK_a3c9142e9d930e75038f81ea9dc"`);
        await queryRunner.query(`ALTER TABLE "customer_order_lines" DROP CONSTRAINT "FK_a08b14bac982377345c9cd3f141"`);
        await queryRunner.query(`ALTER TABLE "customer_order_lines" DROP CONSTRAINT "FK_87cb0be8f629c35df0469d3980e"`);
        await queryRunner.query(`ALTER TABLE "stock_transfers" DROP CONSTRAINT "FK_de39ccb2a7a4ecb7610dc284a0b"`);
        await queryRunner.query(`ALTER TABLE "stock_transfers" DROP CONSTRAINT "FK_efe11b31d123f1c1cee35af9a9c"`);
        await queryRunner.query(`ALTER TABLE "stock_transfers" DROP CONSTRAINT "FK_cd9f1ba0e78a9836d6b8e166a23"`);
        await queryRunner.query(`ALTER TABLE "stock_transfers" DROP CONSTRAINT "FK_294576631d11e1ae8fec5526386"`);
        await queryRunner.query(`ALTER TABLE "stock_transfers" DROP CONSTRAINT "FK_281ba00f4344fb4b1a958245d85"`);
        await queryRunner.query(`ALTER TABLE "stock_transfers" DROP CONSTRAINT "FK_cee3608ef194fa0a22ce9f6377e"`);
        await queryRunner.query(`ALTER TABLE "work_orders" DROP CONSTRAINT "FK_892244c7e30eda7d2406dda545b"`);
        await queryRunner.query(`ALTER TABLE "work_orders" DROP CONSTRAINT "FK_791ae6a4a4f03205d47270e0c62"`);
        await queryRunner.query(`ALTER TABLE "work_orders" DROP CONSTRAINT "FK_ba9233bf837be1df36d25e3a939"`);
        await queryRunner.query(`ALTER TABLE "work_orders" DROP CONSTRAINT "FK_15026f4fdebfcd58e9976034046"`);
        await queryRunner.query(`ALTER TABLE "inventory_transactions" DROP CONSTRAINT "FK_d320a3777b000fa88357a063d7d"`);
        await queryRunner.query(`ALTER TABLE "inventory_transactions" DROP CONSTRAINT "FK_f0ece5f39fcf22fcbe0c69e0c1d"`);
        await queryRunner.query(`ALTER TABLE "inventory" DROP CONSTRAINT "FK_3883f580f1a93c37dba76d42f75"`);
        await queryRunner.query(`ALTER TABLE "inventory" DROP CONSTRAINT "FK_1eea99c8c645d7541002473a015"`);
        await queryRunner.query(`ALTER TABLE "inventory" DROP CONSTRAINT "FK_94f5cbcb5f280f2f30bd4a9fd90"`);
        await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "FK_1523fb2aebce55b9e820122ee0e"`);
        await queryRunner.query(`ALTER TABLE "batches" DROP CONSTRAINT "FK_d5ce6c9463b9c91de64e1898b05"`);
        await queryRunner.query(`ALTER TABLE "items" DROP CONSTRAINT "FK_0c4aa809ddf5b0c6ca45d8a8e80"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_184589c0332faa113faeb95434"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_d4c7b2d2cefc1eaecc6b98847a"`);
        await queryRunner.query(`DROP TABLE "reservations"`);
        await queryRunner.query(`DROP TYPE "public"."reservation_status"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_ea748d97d9c3e0d5f9c1bf7ffc"`);
        await queryRunner.query(`DROP TABLE "customer_orders"`);
        await queryRunner.query(`DROP TYPE "public"."order_status"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_87cb0be8f629c35df0469d3980"`);
        await queryRunner.query(`DROP TABLE "customer_order_lines"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_84004eeaa39e7346921c319d96"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_cee3608ef194fa0a22ce9f6377"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_281ba00f4344fb4b1a958245d8"`);
        await queryRunner.query(`DROP TABLE "stock_transfers"`);
        await queryRunner.query(`DROP TYPE "public"."transfer_status"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_84a22e7f4761f9b56f06b48cd6"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_04b61ed40717e3c95f7514f57b"`);
        await queryRunner.query(`DROP TABLE "work_orders"`);
        await queryRunner.query(`DROP TYPE "public"."work_order_status"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_8f3fd4c00e5434b1791e7262ad"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_a5de1b60af896c157a4bcc13d9"`);
        await queryRunner.query(`DROP TABLE "inventory_transactions"`);
        await queryRunner.query(`DROP TYPE "public"."inventory_txn_type"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_a4a62e5d0870b0e0476bc5e3bb"`);
        await queryRunner.query(`DROP TABLE "inventory"`);
        await queryRunner.query(`DELETE FROM "typeorm_metadata" WHERE "type" = $1 AND "name" = $2 AND "database" = $3 AND "schema" = $4 AND "table" = $5`, ["GENERATED_COLUMN","available_qty","ops_erp","public","inventory"]);
        await queryRunner.query(`DROP INDEX "public"."IDX_ace513fa30d485cfd25c11a9e4"`);
        await queryRunner.query(`DROP TABLE "users"`);
        await queryRunner.query(`DROP TYPE "public"."user_role"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_4189d6a832feca8867fdda65e5"`);
        await queryRunner.query(`DROP TABLE "batches"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_0c4aa809ddf5b0c6ca45d8a8e8"`);
        await queryRunner.query(`DROP TABLE "items"`);
        await queryRunner.query(`DROP TABLE "categories"`);
        await queryRunner.query(`DROP TABLE "locations"`);
    }

}
