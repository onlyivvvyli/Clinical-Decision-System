from app.db.seed import seed_database
from app.db.session import Base, engine


def main():
    Base.metadata.create_all(bind=engine)
    seed_database()
    print("SQLite initialized with demo doctor account.")


if __name__ == "__main__":
    main()
