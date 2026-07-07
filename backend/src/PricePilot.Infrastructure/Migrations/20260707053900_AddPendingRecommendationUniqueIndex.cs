using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace PricePilot.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddPendingRecommendationUniqueIndex : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateIndex(
                name: "ix_recommendations_room_type_id_stay_date",
                table: "recommendations",
                columns: new[] { "room_type_id", "stay_date" },
                unique: true,
                filter: "status = 'pending'");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ix_recommendations_room_type_id_stay_date",
                table: "recommendations");
        }
    }
}
