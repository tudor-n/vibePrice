using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace PricePilot.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class GooglePlacesFoundation : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<decimal>(
                name: "latitude",
                table: "properties",
                type: "numeric(9,6)",
                precision: 9,
                scale: 6,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "longitude",
                table: "properties",
                type: "numeric(9,6)",
                precision: 9,
                scale: 6,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "place_candidates",
                table: "properties",
                type: "jsonb",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "place_id",
                table: "properties",
                type: "character varying(300)",
                maxLength: 300,
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "place_resolved_at",
                table: "properties",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "rating",
                table: "properties",
                type: "numeric(2,1)",
                precision: 2,
                scale: 1,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "rating_count",
                table: "properties",
                type: "integer",
                nullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "source_url",
                table: "competitors",
                type: "character varying(2000)",
                maxLength: 2000,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(2000)",
                oldMaxLength: 2000);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "discovered_at",
                table: "competitors",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "discovery_source",
                table: "competitors",
                type: "character varying(50)",
                maxLength: 50,
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "excluded_at",
                table: "competitors",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "latitude",
                table: "competitors",
                type: "numeric(9,6)",
                precision: 9,
                scale: 6,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "longitude",
                table: "competitors",
                type: "numeric(9,6)",
                precision: 9,
                scale: 6,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "place_candidates",
                table: "competitors",
                type: "jsonb",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "place_id",
                table: "competitors",
                type: "character varying(300)",
                maxLength: 300,
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "place_resolved_at",
                table: "competitors",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "rating",
                table: "competitors",
                type: "numeric(2,1)",
                precision: 2,
                scale: 1,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "rating_count",
                table: "competitors",
                type: "integer",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "points_of_interest",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    city = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    name = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    latitude = table.Column<decimal>(type: "numeric(9,6)", precision: 9, scale: 6, nullable: false),
                    longitude = table.Column<decimal>(type: "numeric(9,6)", precision: 9, scale: 6, nullable: false),
                    weight = table.Column<int>(type: "integer", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_points_of_interest", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "ix_points_of_interest_city",
                table: "points_of_interest",
                column: "city");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "points_of_interest");

            migrationBuilder.DropColumn(
                name: "latitude",
                table: "properties");

            migrationBuilder.DropColumn(
                name: "longitude",
                table: "properties");

            migrationBuilder.DropColumn(
                name: "place_candidates",
                table: "properties");

            migrationBuilder.DropColumn(
                name: "place_id",
                table: "properties");

            migrationBuilder.DropColumn(
                name: "place_resolved_at",
                table: "properties");

            migrationBuilder.DropColumn(
                name: "rating",
                table: "properties");

            migrationBuilder.DropColumn(
                name: "rating_count",
                table: "properties");

            migrationBuilder.DropColumn(
                name: "discovered_at",
                table: "competitors");

            migrationBuilder.DropColumn(
                name: "discovery_source",
                table: "competitors");

            migrationBuilder.DropColumn(
                name: "excluded_at",
                table: "competitors");

            migrationBuilder.DropColumn(
                name: "latitude",
                table: "competitors");

            migrationBuilder.DropColumn(
                name: "longitude",
                table: "competitors");

            migrationBuilder.DropColumn(
                name: "place_candidates",
                table: "competitors");

            migrationBuilder.DropColumn(
                name: "place_id",
                table: "competitors");

            migrationBuilder.DropColumn(
                name: "place_resolved_at",
                table: "competitors");

            migrationBuilder.DropColumn(
                name: "rating",
                table: "competitors");

            migrationBuilder.DropColumn(
                name: "rating_count",
                table: "competitors");

            migrationBuilder.AlterColumn<string>(
                name: "source_url",
                table: "competitors",
                type: "character varying(2000)",
                maxLength: 2000,
                nullable: false,
                defaultValue: "",
                oldClrType: typeof(string),
                oldType: "character varying(2000)",
                oldMaxLength: 2000,
                oldNullable: true);
        }
    }
}
