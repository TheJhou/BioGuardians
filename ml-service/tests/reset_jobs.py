"""Reset old jobs and detections."""
import asyncio, asyncpg, os

async def main():
    conn = await asyncpg.connect(os.environ["DATABASE_URL"])
    n = await conn.execute("DELETE FROM deteccao WHERE image_job_id IS NOT NULL")
    print(f"Deleted {n} detections")
    n2 = await conn.execute("DELETE FROM imagem_job")
    print(f"Deleted {n2} imagem_job records")
    n3 = await conn.execute("DELETE FROM deteccao_job WHERE source IN ('camera_trap','local_dir')")
    print(f"Deleted {n3} jobs")
    await conn.close()

asyncio.run(main())
